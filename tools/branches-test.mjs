// Tests for viewer/js/branches.js and WasmEnginePool.analyze.
// Run: CHESS_TEST_PYTHON=python3 node tools/branches-test.mjs
// Expected values are hand-derived or come from python-chess, never from pasting this module's output.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../viewer/vendor/chess.js';
import { WasmEnginePool } from '../viewer/js/engine-pool.js';
import { WasmTransport } from '../viewer/js/wasm-transport.js';
import * as B from '../viewer/js/branches.js';
import { projectPortableX3D } from '../viewer/js/export.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.CHESS_TEST_PYTHON || 'python3';
const engine = path.join(root, 'viewer/vendor/stockfish/stockfish-19-lite-single.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'branches-'));
let count = 0;
const ok = (name) => { count++; console.log('ok -', name); };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---- 1. parseInfoLine: hand-written UCI lines ----
{
  const p = B.parseInfoLine('info depth 12 seldepth 18 multipv 2 score cp -34 lowerbound nodes 123456 nps 987654 hashfull 3 tbhits 0 time 125 pv e7e5 g1f3 b8c6');
  assert.deepEqual(p, { depth: 12, seldepth: 18, multipv: 2, kind: 'engine_cp', cp: -34, mate: null, bound: 'lowerbound',
    nodes: 123456, nps: 987654, time: 125, pv: ['e7e5', 'g1f3', 'b8c6'] });
  const m = B.parseInfoLine('info depth 5 multipv 1 score mate -3 upperbound nodes 10 pv a8a1');
  assert.equal(m.kind, 'engine_mate'); assert.equal(m.mate, -3); assert.equal(m.cp, null); assert.equal(m.bound, 'upperbound');
  assert.equal(B.parseInfoLine('info depth 3 score cp 20 pv e2e4').multipv, 1);          // multipv defaults to 1
  assert.equal(B.parseInfoLine('info depth 3 score cp 20 pv e2e4').bound, 'exact');
  assert.equal(B.parseInfoLine('info depth 9 score cp 7 wdl 400 500 100 nodes 5 pv e2e4').nodes, 5);
  // regression: Stockfish prints wdl BEFORE the bound; the bound used to be dropped (reported 'exact')
  for (const [l, b] of [['info depth 9 score cp 7 wdl 400 500 100 lowerbound nodes 5 pv e2e4', 'lowerbound'], ['info depth 9 score cp 7 upperbound wdl 400 500 100 nodes 5 pv e2e4', 'upperbound'], ['info depth 9 score cp 7 wdl 400 500 100 nodes 5 pv e2e4', 'exact']])
    assert.equal(B.parseInfoLine(l).bound, b, l);
  // negative controls
  for (const bad of ['info string NNUE evaluation using nn.nnue', 'info depth 5 currmove e2e4 currmovenumber 1', 'bestmove e2e4',
    'info depth 5 score cp abc pv e2e4', 'info depth 5 score cp 1.5 pv e2e4', 'info score cp 5 pv e2e4', 'info depth 5 score foo 5', '', null, 42])
    assert.equal(B.parseInfoLine(bad), null, String(bad));
  ok('parseInfoLine known lines, defaults, mate kind and malformed rejection');
}

// ---- 2. verifyLine ----
{
  const v = B.verifyLine(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);
  assert(v.ok); assert.equal(v.verified, 5); assert.deepEqual(v.san, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.equal(v.fenAfter, 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');   // hand-set Ruy Lopez position
  assert.deepEqual(B.verifyLine(START, 'e2e4 e7e5').san, ['e4', 'e5']);                              // string form
  // castling in UCI and promotion
  assert(B.verifyLine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1', 'e8c8']).ok);
  assert.equal(B.verifyLine('8/P6k/8/8/8/8/8/K7 w - - 0 1', ['a7a8q']).san[0], 'a8=Q');
  // negative controls: illegal at ply 3, truncation reported
  const bad = B.verifyLine(START, ['e2e4', 'e7e5', 'e1e3', 'b8c6']);
  assert.equal(bad.ok, false); assert.equal(bad.verified, 2); assert.equal(bad.total, 4); assert.match(bad.reason, /Ply 3/);
  assert.equal(B.verifyLine(START, ['e2e5']).ok, false);                    // pawn cannot jump 3
  assert.equal(B.verifyLine(START, ['e7e5']).ok, false);                    // wrong side to move
  assert.equal(B.verifyLine(START, ['e2e4e5']).ok, false);                  // malformed
  assert.equal(B.verifyLine(START, ['e2e4q']).ok, false);                   // superfluous promotion letter
  assert.equal(B.verifyLine('8/P6k/8/8/8/8/8/K7 w - - 0 1', ['a7a8']).ok, false);   // promotion piece missing
  assert.equal(B.verifyLine(START, []).ok, false);
  assert.equal(B.verifyLine('not a fen', ['e2e4']).ok, false);
  assert.equal(B.verifyLine('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', ['h8g8']).ok, false); // king may not step onto g8 (attacked by Qf7)
  assert.equal(B.verifyLine(START, new Array(200).fill('e2e4')).ok, false);
  ok('verifyLine legal lines, castling/promotion, truncation point, wrong side, malformed, superfluous promotion');
}

// ---- 3. normalizeResult: white perspective, kinds and bounds distinct ----
{
  const wFen = START, bFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const wr = B.normalizeResult({ fenSearched: wFen, lines: [
    'info depth 8 multipv 1 score cp 30 nodes 1 pv e2e4', 'info depth 8 multipv 2 score mate 3 lowerbound nodes 1 pv d2d4',
    { depth: 8, multipv: 3, cp: null, mate: null, pv: ['c2c4'] }] });
  assert.deepEqual(wr.lines.map((l) => [l.rank, l.evaluation_kind, l.cp, l.mate, l.score_bound]),
    [[1, 'engine_cp', 30, null, 'exact'], [2, 'engine_mate', null, 3, 'lowerbound'], [3, 'unavailable', null, null, null]]);
  const br = B.normalizeResult({ fenSearched: bFen, lines: [
    'info depth 8 multipv 1 score cp 50 lowerbound pv e7e5', 'info depth 8 multipv 2 score mate 3 pv c7c5', 'info depth 8 multipv 3 score mate -2 upperbound pv d7d5', 'info depth 8 multipv 4 score cp 0 pv g8f6'] });
  assert.deepEqual(br.lines.map((l) => [l.cp, l.mate, l.score_bound]),
    [[-50, null, 'upperbound'], [null, -3, 'exact'], [null, 2, 'lowerbound'], [0, null, 'exact']]);
  assert(br.lines.every((l) => l.score_pov === 'white' && l.eval_fen === br.fenSearched));
  assert(!Object.is(br.lines[3].cp, -0));
  // deepest line per rank wins; later wins ties
  const d = B.normalizeResult({ fenSearched: wFen, lines: ['info depth 4 multipv 1 score cp 10 pv e2e4', 'info depth 6 multipv 1 score cp 25 pv d2d4', 'info depth 5 multipv 1 score cp 99 pv c2c4'] });
  assert.equal(d.lines.length, 1); assert.equal(d.lines[0].cp, 25); assert.equal(d.lines[0].depth, 6);
  assert.equal(B.normalizeResult({ fenSearched: wFen, lines: ['garbage', 'info depth 5 score cp x pv a'] }).dropped, 2);
  assert.throws(() => B.normalizeResult({ fenSearched: 'bad fen', lines: [] }), /valid searched FEN/);
  assert.throws(() => B.normalizeResult({ fenSearched: wFen, lines: 'x' }), /lines array/);
  // labels keep kind and bound visible
  assert.match(B.formatScore(wr.lines[1]), /^>= mate \+3 \(White mates\)$/);
  assert.match(B.formatScore(br.lines[0]), /^<= cp -50$/);
  assert.equal(B.formatScore(wr.lines[2]), 'no score');
  ok('normalizeResult flips side-to-move scores and bounds, keeps mate/bound/null distinct, rejects bad input');
}

// ---- 4. acceptResult: stale FEN dropped ----
{
  const fen1 = START, c = new Chess(); c.move('e4'); const fen2 = c.fen();
  const res = { fenSearched: fen1, lines: [] };
  assert.equal(B.acceptResult(fen1, res).accepted, true);
  const stale = B.acceptResult(fen2, res); assert.equal(stale.accepted, false); assert.match(stale.reason, /Stale/);
  assert.equal(B.acceptResult({ fen: fen1, revision: 3 }, { ...res, revision: 2 }).accepted, false);
  assert.equal(B.acceptResult({ fen: fen1, revision: 3 }, { ...res, revision: 3 }).accepted, true);
  assert.equal(B.acceptResult('junk', res).accepted, false);
  assert.equal(B.acceptResult(fen1, {}).accepted, false);
  // same placement, other side to move is a different position
  assert.equal(B.acceptResult(START.replace(' w ', ' b '), res).accepted, false);
  ok('acceptResult drops results for another FEN, side to move or older revision');
}

// ---- 5. geometry: hand-derived coordinates ----
{
  const o = [10, 0, -5];
  const mk = (rank, pv) => ({ rank, depth: 8, evaluation_kind: 'engine_cp', cp: 12, mate: null, score_bound: 'exact', pv });
  const g = B.branchGeometry(START, [mk(1, ['e2e4', 'e7e5', 'g1f3']), mk(2, ['d2d4'])], o);
  assert.equal(g.length, 2);
  // square centre x = ox + file - 3.5, z = oz + 3.5 - (rank-1); hand values: e2 (10.5,-2.5) e4 (10.5,-4.5) e7 (10.5,-7.5) e5 (10.5,-5.5) g1 (12.5,-1.5) f3 (11.5,-3.5)
  // heights: 0.45 + 0.3*(rank-1) + 0.12*ply ; apex = max(prev, h) + 0.25 at the midpoint of consecutive polyline squares ; start y = 0.2
  const exp = [[10.5, 0.2, -2.5], [10.5, 0.82, -3.5], [10.5, 0.57, -4.5], [10.5, 0.94, -5], [10.5, 0.69, -5.5], [11, 1.06, -4.5], [11.5, 0.81, -3.5]];
  g[0].points.forEach((p, i) => p.forEach((v, j) => assert(Math.abs(v - exp[0 + i][j]) < 1e-9, `pt ${i}.${j}: ${v} vs ${exp[i][j]}`)));
  assert.equal(g[0].points.length, 7); assert.deepEqual(g[0].coordIndex, [0, 1, 2, 3, 4, 5, 6, -1]);
  assert.deepEqual(g[0].squares, ['e2', 'e4', 'e5', 'f3']); assert.deepEqual(g[0].san, ['e4', 'e5', 'Nf3']);
  // rank 2, d2d4: d2 (9.5,-2.5) d4 (9.5,-4.5); h = 0.45+0.3+0.12 = 0.87; apex 1.12
  assert.deepEqual(g[1].points, [[9.5, 0.2, -2.5], [9.5, 1.12, -3.5], [9.5, 0.87, -4.5]]);
  assert.notEqual(g[0].color, g[1].color); assert.equal(g[0].color, B.RANK_COLORS[0]);
  assert.equal(g[0].label, '#1 d8 cp +12 (White POV) e4');
  assert(g[0].points.every((p) => p.every(Number.isFinite)));
  // maxPlies bound and display truncation flag
  const long = B.branchGeometry(START, [mk(1, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'])], o)[0];
  assert.equal(long.plies, 8); assert.equal(long.points.length, 17); assert(long.truncatedForDisplay);
  // negative control: a corrupted line is omitted even if the caller claims it is verified
  const corrupt = { ...mk(1, ['e2e4', 'e7e5', 'e4e4']), verification: { ok: true } };
  assert.equal(B.branchGeometry(START, [corrupt, mk(2, ['d2d4'])], o).length, 1);
  // regression: duplicate rank is drawn once; missing depth never prints 'undefined'
  assert.equal(B.branchGeometry(START, [mk(1, ['e2e4']), mk(1, ['d2d4'])], o).length, 1);
  assert(!/undefined/.test(B.branchGeometry(START, [{ rank: 1, evaluation_kind: 'engine_cp', cp: 1, pv: ['e2e4'] }], o)[0].label));
  // regression: every apex lies on the line between consecutive squares of the polyline (x/z midpoint of squares[i], squares[i+1])
  const sq = (s) => [o[0] + 'abcdefgh'.indexOf(s[0]) - 3.5, o[2] + 3.5 - (Number(s[1]) - 1)];
  g[0].squares.slice(1).forEach((s2, i) => { const a = sq(g[0].squares[i]), b = sq(s2), ap = g[0].points[1 + 2 * i];
    assert(Math.abs(ap[0] - (a[0] + b[0]) / 2) < 1e-9 && Math.abs(ap[2] - (a[1] + b[1]) / 2) < 1e-9, 'apex ' + i); });
  assert.throws(() => B.branchGeometry(START, [], [1, 2]), /origin/);
  ok('branchGeometry matches hand-derived coordinates, bounds plies, omits corrupted lines');
}

// ---- 6. X3D validity + SAI adapter ----
const sceneFor = (xml) => {   // minimal SAI stand-in over the generated slots
  const nodes = new Map(), re = /DEF='(bl_(?:coord|ils)_\d+)'/g; let m;
  while ((m = re.exec(xml))) nodes.set(m[1], {});
  return { nodes, getNamedNode(n) { const x = nodes.get(n); if (!x) throw new Error('no node ' + n); return x; } };
};
const fakeX3D = { MFVec3f: class { constructor(...a) { this.v = a; } }, SFVec3f: class { constructor(...a) { this.v = a; } }, MFInt32: class { constructor(...a) { this.v = a; } } };
{
  const o = [0, 0, 0], xml = B.branchesXml(o);
  assert(!/pointerEvents='true'/.test(xml)); assert.equal((xml.match(/pointerEvents='false'/g) || []).length, 5);
  assert.throws(() => B.branchesXml(o, 6), /maxLines/); assert.throws(() => B.branchesXml([0, 0]), /origin/);
  const geom = B.branchGeometry(START, [{ rank: 1, depth: 8, evaluation_kind: 'engine_cp', cp: 5, score_bound: 'exact', pv: ['e2e4', 'e7e5'] }, { rank: 3, depth: 8, evaluation_kind: 'engine_mate', mate: 2, score_bound: 'exact', pv: ['g1f3'] }], o);
  const scene = sceneFor(xml); B.applyBranchesToScene(scene, geom, 5, fakeX3D);
  assert.equal(scene.getNamedNode('bl_coord_0').point.v.length, 5);                                // 1 + 2 plies*2 vertices
  assert.deepEqual(scene.getNamedNode('bl_ils_0').coordIndex.v, [0, 1, 2, 3, 4, -1]);
  assert.deepEqual(scene.getNamedNode('bl_ils_1').coordIndex.v, [-1]);                             // unused slot blanked
  assert.equal(scene.getNamedNode('bl_coord_2').point.v.length, 3);
  B.applyBranchesToScene(scene, [], 5, fakeX3D);                                                   // clearing leaves nothing stale
  for (let k = 0; k < 5; k++) assert.deepEqual(scene.getNamedNode(`bl_ils_${k}`).coordIndex.v, [-1]);
  // validate the empty and the populated documents with the pinned validator
  const inject = (x, updates) => updates.reduce((acc, u, k) => acc
    .replace(new RegExp(`(DEF='bl_ils_${k}' coordIndex=')[^']*(')`), `$1${u.coordIndex.join(' ')}$2`)
    .replace(new RegExp(`(DEF='bl_coord_${k}' point=')[^']*(')`), `$1${u.point.map((p) => p.join(' ')).join(', ')}$2`), x);
  const populated = inject(xml, B.branchUpdates(geom, 5));
  assert.notEqual(populated, xml); assert(populated.includes(String(geom[0].points[1][1])));
  const validate = (name, text) => {
    // pointerEvents is an X_ITE extension outside the XSD; the runtime-fragment gate validates the documented portable projection.
    const projected = projectPortableX3D(text, { title: 'branches ' + name });
    assert.equal(projected.losses[0].records, 5);
    const f = path.join(tmp, name + '.x3d'), out = path.join(tmp, name + '.json'); fs.writeFileSync(f, projected.xml);
    spawnSync(python, [path.join(root, 'tools/validate_x3d.py'), f, '--output', out], { cwd: root, encoding: 'utf8' });
    return JSON.parse(fs.readFileSync(out, 'utf8')).files[0];
  };
  for (const [name, text] of [['empty', xml], ['populated', populated]]) {
    const r = validate(name, text); assert.equal(r.status, 'pass', name + ' ' + JSON.stringify(r.xsd.findings) + JSON.stringify(r.semantic.findings));
  }
  const broken = validate('broken', populated.replace(/coordIndex='0 1 2 3 4 -1'/, "coordIndex='0 x 2'"));
  assert.notEqual(populated.replace(/coordIndex='0 1 2 3 4 -1'/, "coordIndex='0 x 2'"), populated);   // negative control
  assert.equal(broken.xsd.status, 'fail');
  ok('branchesXml empty and populated documents pass the pinned X3D validator; SAI writes and blanking; corrupted XML fails');
}

// ---- 7. pool.analyze with a fake worker: bounded, serialized, restores MultiPV, stale guards intact ----
class FakeWorker {
  constructor() { this.commands = []; this.dead = false; }
  emit(d) { this.onmessage?.({ data: d }); }
  postMessage(c) {
    this.commands.push(c);
    if (c === 'uci') { this.emit('id name Fake'); this.emit('uciok'); }
    if (c === 'isready') this.emit('readyok');
    if (c.startsWith('go ')) {
      this.emit('info depth 3 multipv 1 score cp 10 nodes 5 pv e2e4'); this.emit('info depth 4 multipv 1 score cp 20 nodes 9 pv d2d4 d7d5');
      this.emit('info depth 4 multipv 2 score cp 15 nodes 9 pv e2e4 e7e5'); this.emit('bestmove d2d4');
    }
  }
  terminate() { this.dead = true; }
}
{
  const workers = [], pool = new WasmEnginePool({ size: 1, workerFactory: () => { const w = new FakeWorker(); workers.push(w); return w; }, initTimeoutMs: 100, searchTimeoutMs: 100 });
  await pool.init();
  const [a, b] = await Promise.all([pool.analyze(START, { multipv: 2, depth: 4 }), pool.analyze(START, { multipv: 3, depth: 5, movetime: 50 })]);
  assert.equal(a.fenSearched, START); assert.deepEqual(a.lines.map((l) => [l.rank, l.cp, l.depth]), [[1, 20, 4], [2, 15, 4]]);
  assert.deepEqual(a.request, { multipv: 2, depth: 4, movetime: null }); assert.equal(a.engine, 'Fake'); assert.equal(a.nodes, 9);
  const c = workers[0].commands, go = c.filter((x) => x.startsWith('go '));
  assert.deepEqual(go, ['go depth 4', 'go depth 5 movetime 50']);
  assert.deepEqual(c.filter((x) => x.includes('MultiPV')), ['setoption name MultiPV value 2', 'setoption name MultiPV value 1', 'setoption name MultiPV value 3', 'setoption name MultiPV value 1']);
  assert.equal(c.at(-1), 'setoption name MultiPV value 1');
  for (const bad of [{ multipv: 0 }, { multipv: 6 }, { depth: 0 }, { depth: 31 }, { movetime: 5 }, { multipv: 1.5 }]) await assert.rejects(pool.analyze(START, bad), /must be an integer/);
  await assert.rejects(pool.analyze('not a fen'), /FEN/);
  // a game search after analysis starts a fresh game and still works
  const before = c.length; await pool.search(START, { depth: 3, gameKey: 'g0:1' });
  assert(c.slice(before).includes('ucinewgame'));
  assert.equal(pool.state, 'running'); pool.terminate();
  await assert.rejects(pool.analyze(START), (e) => e.name === 'AbortError');            // stale/closed pool guard
  const t = new WasmTransport(() => {}); await assert.rejects(t.analyze(START), /not running/);
  ok('pool.analyze is bounded, validated, serialized, restores MultiPV 1, forces ucinewgame, rejects after terminate');
}

// ---- 8. real Stockfish WASM under Node ----
class NodeUciWorker {
  constructor() {
    this.closed = false; this.errors = ''; this.child = spawn(process.execPath, [engine], { stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => this.onmessage?.({ data: line }));
    this.child.stderr.on('data', (d) => { this.errors += d.toString(); });
    this.child.on('error', (e) => this.onerror?.({ message: e.message, preventDefault() {} }));
    this.child.on('exit', (code, sig) => { if (!this.closed) this.onerror?.({ message: `Stockfish exited ${code ?? sig}: ${this.errors.slice(-300)}`, preventDefault() {} }); });
  }
  postMessage(c) { this.child.stdin.write(c + '\n'); }
  terminate() { this.closed = true; this.child.kill(); }
}
const cases = [   // expectations are hand-judged
  { id: 'black-queen-down-black-to-move', fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', white: 'ahead' },       // Black lacks the d8 queen
  { id: 'white-queen-down-white-to-move', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1', white: 'behind' },      // White lacks the d1 queen
  { id: 'white-back-rank-mate-in-1', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', mate: 1, first: 'a1a8' },                            // Ra8#
  { id: 'black-back-rank-mate-in-1', fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', mate: -1, first: 'a8a1' },                           // ...Ra1#
];
const pool = new WasmEnginePool({ size: 1, workerFactory: () => new NodeUciWorker(), initTimeoutMs: 20000, searchTimeoutMs: 60000 });
const runs = [];
try {
  await pool.init();
  for (const c of cases) {
    const result = await pool.analyze(c.fen, { multipv: 3, depth: 8 });
    assert.equal(result.fenSearched, new Chess(c.fen).fen()); assert.equal(result.lines.length, 3, c.id);
    const verified = B.verifyResult(result);
    assert.equal(verified.rejected.length, 0, c.id + ' ' + JSON.stringify(verified.rejected.map((r) => r.verification.reason)));
    assert.equal(verified.lines.length, 3);
    const firsts = result.lines.map((l) => l.pv[0]); assert.equal(new Set(firsts).size, 3, c.id + ' distinct first moves');
    assert.deepEqual(result.lines.map((l) => l.rank), [1, 2, 3]);
    assert(result.lines.every((l) => l.score_pov === 'white' && l.eval_fen === result.fenSearched && l.depth >= 1));
    if (c.white === 'ahead') assert(result.lines.every((l) => l.evaluation_kind === 'engine_cp' && l.cp > 300), c.id + JSON.stringify(result.lines.map((l) => l.cp)));
    if (c.white === 'behind') assert(result.lines.every((l) => l.evaluation_kind === 'engine_cp' && l.cp < -300), c.id + JSON.stringify(result.lines.map((l) => l.cp)));
    if (c.mate) {
      const l1 = result.lines[0];
      assert.equal(l1.evaluation_kind, 'engine_mate'); assert.equal(l1.mate, c.mate); assert.equal(l1.cp, null); assert.equal(l1.pv[0], c.first);
      assert(['exact', 'lowerbound', 'upperbound'].includes(l1.score_bound));   // bound reported, never coerced to null
      assert.equal(B.formatScore(l1).includes(c.mate > 0 ? 'White mates' : 'Black mates'), true);
    }
    const geom = B.branchGeometry(result.fenSearched, verified.lines, [0, 0, 0]);
    assert.equal(geom.length, 3); assert(geom.every((g) => g.points.every((p) => p.every(Number.isFinite))));
    runs.push({ ...c, result, verified });
  }
  // the pool still plays games normally after analysis (MultiPV restored): search returns a legal move
  const after = await pool.search(START, { depth: 5, gameKey: 'post-analysis' });
  assert(B.verifyLine(START, [after.uci]).ok);
} finally { pool.terminate(); }

// independent cross-check with python-chess: legality of every engine PV, mate on the first move, corrupted PV rejected
const payload = runs.map((r) => ({ id: r.id, fen: r.fen, pvs: r.result.lines.map((l) => l.pv),
  corrupt: [...r.result.lines[0].pv.slice(0, 1), r.result.lines[0].pv[0], ...r.result.lines[0].pv.slice(1)] }));
const py = spawnSync(python, ['-I', '-c', `
import sys, json, chess
out = []
for c in json.load(sys.stdin):
    def legal(pv):
        b = chess.Board(c['fen'])
        for i, u in enumerate(pv):
            m = chess.Move.from_uci(u)
            if m not in b.legal_moves: return i
            b.push(m)
        return len(pv)
    mates = []
    for pv in c['pvs']:
        b = chess.Board(c['fen']); b.push(chess.Move.from_uci(pv[0])); mates.append(b.is_checkmate())
    out.append({'id': c['id'], 'all_legal': [legal(p) == len(p) for p in c['pvs']], 'first_mates': mates, 'corrupt_verified': legal(c['corrupt'])})
print(json.dumps(out))`], { input: JSON.stringify(payload), encoding: 'utf8' });
assert.equal(py.status, 0, py.stderr);
for (const [i, row] of JSON.parse(py.stdout).entries()) {
  const r = runs[i]; assert.equal(row.id, r.id);
  assert(row.all_legal.every(Boolean), r.id + ' python-chess disagrees: engine PV illegal');
  assert.equal(row.corrupt_verified, 1, 'python-chess must reject the corrupted PV at ply 2');
  assert.equal(B.verifyLine(r.fen, payload[i].corrupt).ok, false); assert.equal(B.verifyLine(r.fen, payload[i].corrupt).verified, 1);
  if (r.mate) assert.equal(row.first_mates[0], true, r.id + ' first move must mate (python-chess)');
}
ok(`real Stockfish WASM, 4 FENs x multipv 3 depth 8: PVs legal (chess.js and python-chess), distinct first moves, signs match hand judgment, mate kind +1/-1 kept`);

// negative control on real data: stale FEN dropped, corrupted PV excluded from geometry
{
  const r = runs[0].result, c = new Chess(runs[0].fen); c.move({ from: r.lines[0].pv[0].slice(0, 2), to: r.lines[0].pv[0].slice(2, 4) });
  assert.equal(B.acceptResult(c.fen(), r).accepted, false); assert.equal(B.acceptResult(runs[0].fen, r).accepted, true);
  const damaged = { ...r, lines: r.lines.map((l, i) => (i === 0 ? { ...l, pv: [l.pv[0], l.pv[0]] } : l)) };
  const v = B.verifyResult(damaged); assert.equal(v.rejected.length, 1); assert.equal(v.rejected[0].rank, 1); assert.equal(v.lines.length, 2);
  assert.equal(B.branchGeometry(damaged.fenSearched, damaged.lines, [0, 0, 0]).length, 2);
  // sign-flip control: if scores were left in side-to-move terms the black-to-move queen-up case would be negative
  assert(runs[0].result.lines[0].cp > 0 && runs[0].result.sideToMove === 'b');
  ok('stale FEN dropped and corrupted engine PV excluded on real results');
}

assert(B.LEGEND.pv.includes('not an exhaustive') && B.LEGEND.pv.includes('proof'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PASS ${count} branches test groups`);
