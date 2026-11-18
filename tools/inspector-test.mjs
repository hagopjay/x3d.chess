// Square inspector tests. Expected values are hand-derived (comments give the reasoning) or come from
// python-chess via tools/inspector_expect.py (fixed seed, committed as tools/inspector-expect.json and
// regenerated and compared byte for byte on every run). Nothing is pasted from the module under test.
// Run: CHESS_TEST_PYTHON=python3 node tools/inspector-test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Chess} from '../viewer/vendor/chess.js';
import {controlGrid} from '../viewer/js/analysis.js';
import {sqPos} from '../viewer/js/board.js';
import {projectPortableX3D} from '../viewer/js/export.js';
import * as I from '../viewer/js/inspector.js';
import {describeInspection} from '../viewer/js/lenses.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.env.CHESS_TEST_PYTHON || 'python3';
const FILES = 'abcdefgh', SQUARES = Array.from({length: 64}, (_, i) => FILES[i % 8] + (Math.floor(i / 8) + 1));
const failures = [];
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(name + ': ' + (e.stack || e.message).split('\n').slice(0, 14).join(' | ')); }
}
const dests = (fen, sq) => I.inspect(fen, sq).legal.destinations.map(d => d.to).sort();
const froms = (list) => list.map(a => a.square).sort();

// ---- 1. study catalog: pinned knight still covers f5 ---------------------------------------------
const PIN = '4k3/4n3/8/8/5K2/8/8/4R3 w - - 0 1';
test('inspector summary distinguishes an opponent piece from a piece with zero legal destinations', () => {
  assert.match(describeInspection(I.inspect(PIN, 'e7')), /legal destinations: n\/a \(not the side to move\)/);
  assert.match(describeInspection(I.inspect(PIN.replace(' w ', ' b '), 'e7')), /0 legal destinations/);
});
test('inspector summary counts destinations separately from promotion choices', () => {
  const ins = I.inspect('7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7');
  assert.equal(ins.legal.moves.length, 4); assert.equal(ins.legal.destinations.length, 1);
  assert.match(describeInspection(ins), /1 legal destination(?: ·|$)/);
});
test('pin paradox: pinned knight e7 geometrically attacks f5 but its move would be illegal', () => {
  const f5 = I.inspect(PIN, 'f5');
  assert.equal(f5.piece, null);
  assert.deepEqual(froms(f5.attackedBy.b), ['e7']);            // knight e7 -> f5 is a knight jump
  assert.deepEqual(froms(f5.attackedBy.w), ['f4']);            // only the king on f4 is adjacent; Re1 only sees the e-file
  const n = f5.attackedBy.b[0];
  assert.equal(n.pinned, true); assert.equal(n.attackLegalToPlay, false); assert.equal(n.legalBasis, 'turn-flipped');
  assert.equal(n.pin.pinner, 'e1'); assert.equal(n.pin.king, 'e8');
  assert.equal(f5.attackedBy.w[0].attackLegalToPlay, false);   // Kf5 would step onto an attacked square
  assert.equal(f5.kingSafety.relativeTo, 'w'); assert.equal(f5.kingSafety.attackedByEnemy, true);
  assert.deepEqual(f5.kingSafety.enemyAttackers, ['e7']);
  assert.deepEqual(f5.control, {...f5.control, white: 1, black: 1, balance: 0});
});
test('pin paradox: king f4 legal destinations exclude f5 (hand: 8 neighbours minus the knight-covered f5)', () => {
  assert.deepEqual(dests(PIN, 'f4'), ['e3', 'e4', 'e5', 'f3', 'g3', 'g4', 'g5']);
});
test('pin ray: knight e7 is pinned along e8..e1; ray starts at the king and ends on the pinner', () => {
  const e7 = I.inspect(PIN, 'e7');
  assert.equal(e7.pin.pinned, true); assert.equal(e7.pin.pinner, 'e1'); assert.equal(e7.pin.king, 'e8');
  assert.deepEqual(e7.pin.rayFromKing, ['e7', 'e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
  assert.deepEqual(e7.pin.lineSquares, ['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
  const e1 = I.inspect(PIN, 'e1');
  assert.equal(e1.pin.pinned, false);
  assert.deepEqual(e1.pinning, [{pinned: 'e7', king: 'e8', rayFromKing: ['e7', 'e6', 'e5', 'e4', 'e3', 'e2', 'e1']}]);
});
test('pinned knight with Black to move has no legal destinations (a knight cannot stay on the e-file)', () => {
  const e7 = I.inspect('4k3/4n3/8/8/5K2/8/8/4R3 b - - 0 1', 'e7');
  assert.equal(e7.legal.sideToMove, true); assert.deepEqual(e7.legal.destinations, []);
  assert.equal(e7.pin.pinned, true);
});
test('unpinned variant: knight attack on f5 is also legal to play (flip Black to move)', () => {
  const f5 = I.inspect('4k3/4n3/8/8/5K2/8/8/R7 w - - 0 1', 'f5');
  assert.equal(f5.attackedBy.b[0].pinned, false); assert.equal(f5.attackedBy.b[0].attackLegalToPlay, true);
});
test('not the mover: no legal moves listed for the other colour', () => {
  const e7 = I.inspect(PIN, 'e7');
  assert.equal(e7.legal.sideToMove, false); assert.deepEqual(e7.legal.moves, []); assert.match(e7.legal.note, /Not this colour/);
});

// ---- 2. en passant rank exposure -----------------------------------------------------------------
const EP_BAD = 'k7/8/8/r4pPK/8/8/8/8 w - f6 0 1', EP_OK = 'k7/8/8/5pPK/r7/8/8/8 w - f6 0 1';
test('en passant exposure: g5xf6 is illegal (removing g5+f5 opens the a5 rook onto Kh5); only g6 remains', () => {
  assert.deepEqual(dests(EP_BAD, 'g5'), ['g6']);
  const f6 = I.inspect(EP_BAD, 'f6');
  assert.deepEqual(froms(f6.attackedBy.w), ['g5']);             // pawn g5 geometrically attacks f6
  assert.equal(f6.attackedBy.w[0].attackLegalToPlay, false);
  assert.equal(f6.attackedBy.w[0].pinned, false);               // not an absolute pin: the f5 pawn also leaves the rank
  assert.equal(I.inspect(EP_BAD, 'g5').pin.pinned, false);
});
test('en passant allowed when the rank is clear: g5f6 flagged e/capture, captured pawn on f5', () => {
  assert.deepEqual(dests(EP_OK, 'g5'), ['f6', 'g6']);
  const m = I.inspect(EP_OK, 'g5').legal.moves.find(x => x.to === 'f6');
  assert.equal(m.enPassant, true); assert.equal(m.capture, true); assert.equal(m.epCapturedSquare, 'f5'); assert.match(m.flags, /e/);
  assert.equal(I.inspect(EP_OK, 'f6').attackedBy.w[0].attackLegalToPlay, true);
});

// ---- 3. castling with attacked transit square ---------------------------------------------------
const CASTLE_BAD = 'k4r2/8/8/8/8/8/8/4K2R w K - 0 1', CASTLE_OK = 'rk6/8/8/8/8/8/8/4K2R w K - 0 1';
test('castling transit f1 attacked by the f8 rook: no O-O; king keeps d1 d2 e2 (f1,f2 on the rook file)', () => {
  assert.deepEqual(dests(CASTLE_BAD, 'e1'), ['d1', 'd2', 'e2']);
  assert.equal(I.inspect(CASTLE_BAD, 'e1').legal.moves.some(m => m.castle), false);
  const f1 = I.inspect(CASTLE_BAD, 'f1');
  assert.equal(f1.kingSafety.attackedByEnemy, true); assert.deepEqual(f1.kingSafety.enemyAttackers, ['f8']);
  assert.deepEqual(froms(f1.attackedBy.w), ['e1', 'h1']);       // king and rook both cover f1
});
test('castling legal when the transit is safe: g1 flagged k with SAN O-O', () => {
  assert.deepEqual(dests(CASTLE_OK, 'e1'), ['d1', 'd2', 'e2', 'f1', 'f2', 'g1']);
  const g1 = I.inspect(CASTLE_OK, 'e1').legal.moves.find(m => m.to === 'g1');
  assert.equal(g1.castle, 'k'); assert.equal(g1.san, 'O-O'); assert.equal(g1.capture, false);
  assert.equal(I.inspect(CASTLE_OK, 'f1').kingSafety.attackedByEnemy, false);
});

// ---- 4. double check: only king moves ------------------------------------------------------------
const DBL = 'rn2k3/p7/8/1B6/7q/8/8/4R1K1 b - - 0 1';
test('double check (Re1 + Bb5): non-king pieces have no legal destinations; king has exactly d8 f7 f8', () => {
  const e8 = I.inspect(DBL, 'e8');
  assert.equal(e8.position.inCheck, true); assert.equal(e8.position.doubleCheck, true);
  assert.deepEqual(e8.position.checkers, ['b5', 'e1']);
  assert.deepEqual(e8.legal.destinations.map(d => d.to).sort(), ['d8', 'f7', 'f8']);   // e7: rook file, d7: bishop diagonal
  for (const s of ['a8', 'b8', 'a7', 'h4']) assert.deepEqual(I.inspect(DBL, s).legal.destinations, [], s);
  // Qxe1 looks available geometrically yet is not legal: attack != legal move
  const e1 = I.inspect(DBL, 'e1');
  assert.deepEqual(froms(e1.attackedBy.b), ['h4']);
  assert.equal(e1.attackedBy.b[0].attackLegalToPlay, false);
  assert.equal(e1.kingSafety.attackedByEnemy, true);
});

// ---- 5. promotion destinations -------------------------------------------------------------------
test('promotion: every destination offers exactly b n q r; capture promotion flagged separately', () => {
  const ins = I.inspect('1n2k3/2P5/8/8/8/8/8/4K3 w - - 0 1', 'c7');
  assert.deepEqual(ins.legal.destinations.map(d => d.to), ['b8', 'c8']);
  for (const d of ins.legal.destinations) { assert.deepEqual(d.promotions, ['b', 'n', 'q', 'r']); assert.equal(d.moves, 4); }
  assert.equal(ins.legal.destinations.find(d => d.to === 'b8').capture, true);
  assert.equal(ins.legal.destinations.find(d => d.to === 'c8').capture, false);
  assert.equal(ins.legal.moves.length, 8);
  const study = I.inspect('8/k1P5/2K5/8/8/8/8/8 w - - 0 1', 'c7');
  assert.deepEqual(study.legal.destinations.map(d => [d.to, d.promotions.join('')]), [['c8', 'bnqr']]);
});

// ---- 6. x-ray / battery detection and negative -------------------------------------------------------
test('battery: queen behind a rook on the e-file is a member; the line ends at the black king', () => {
  const fen = '4k3/8/8/8/8/8/4R3/4Q1K1 w - - 0 1';
  assert.deepEqual(I.inspect(fen, 'e2').xray, [{direction: [0, -1], members: ['e1'], beyond: null}]);
  const q = I.inspect(fen, 'e1').xray;
  assert.equal(q.length, 1); assert.deepEqual(q[0].members, ['e2']); assert.deepEqual(q[0].beyond, {square: 'e8', type: 'k', color: 'b'});
});
test('negative control: a bishop between does not move along the file, so no battery is reported', () => {
  assert.deepEqual(I.inspect('4k3/8/8/8/8/8/4B3/4Q1K1 w - - 0 1', 'e1').xray, []);
  assert.deepEqual(I.inspect('4k3/8/8/8/8/8/4R3/4Q1K1 w - - 0 1', 'g1').xray, []);     // king: not a slider
});

// ---- 7. study catalog against saved python-chess witnesses ------------------------------------------
test('study catalog: attack queries, pin queries and full legal-move witnesses agree', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'viewer/data/studies.json'), 'utf8'));
  let variants = 0, queries = 0;
  for (const lesson of cat.studies) for (const v of lesson.variants) {
    variants++;
    for (const q of v.attack_queries || []) { queries++; assert.deepEqual(froms(I.inspect(v.fen, q.square).attackedBy[q.color]), [...q.expected_attackers].sort()); }
    for (const q of v.pin_queries || []) { queries++; assert.equal(I.inspect(v.fen, q.square).pin.pinned, q.expected_pinned); }
    const all = SQUARES.flatMap(s => I.inspect(v.fen, s).legal.moves.map(m => m.uci)).sort();
    assert.deepEqual(all, [...v.witness.legal_moves].sort(), lesson.id + '/' + v.id);
    for (const p of v.probes) assert.equal(I.inspect(v.fen, p.uci.slice(0, 2)).legal.moves.some(m => m.uci === p.uci), p.legal, p.uci);
  }
  assert.equal(variants, 7); assert(queries >= 2);
});

// ---- 8. keyboard navigation --------------------------------------------------------------------------
test('navigate: arrows/WASD, clamping, Escape, unknown keys (white at the bottom)', () => {
  const eq = (sq, key, want) => assert.deepEqual(I.navigate(sq, key).square, want, sq + ' ' + key);
  eq('e4', 'ArrowUp', 'e5'); eq('e4', 'w', 'e5'); eq('e4', 'W', 'e5'); eq('e4', 'ArrowDown', 'e3'); eq('e4', 's', 'e3');
  eq('e4', 'ArrowLeft', 'd4'); eq('e4', 'a', 'd4'); eq('e4', 'ArrowRight', 'f4'); eq('e4', 'D', 'f4');
  eq('a1', 'ArrowLeft', 'a1'); eq('a1', 'ArrowDown', 'a1'); eq('h8', 'ArrowUp', 'h8'); eq('h8', 'd', 'h8'); eq('a8', 'ArrowUp', 'a8'); eq('h1', 'ArrowRight', 'h1');
  assert.equal(I.navigate('a1', 'ArrowLeft').changed, false); assert.equal(I.navigate('a1', 'ArrowUp').changed, true);
  assert.deepEqual(I.navigate('e4', 'Escape'), {square: null, handled: true, changed: true});
  assert.deepEqual(I.navigate(null, 'Escape'), {square: null, handled: true, changed: false});
  assert.equal(I.navigate(null, 'ArrowRight').square, I.NAV_START);
  assert.deepEqual(I.navigate('e4', 'x'), {square: 'e4', handled: false, changed: false});
  assert.deepEqual(I.navigate('e4', undefined), {square: 'e4', handled: false, changed: false});
  assert.deepEqual(I.navigate('e4', 'constructor'), {square: 'e4', handled: false, changed: false});
  assert.throws(() => I.navigate('i9', 'w'), RangeError); assert.throws(() => I.navigate('e', 'w'), RangeError);
});
test('navigate: all 64 squares x 8 keys stay on the board and match an independent coordinate model', () => {
  const keys = {ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0]};
  for (const sq of SQUARES) for (const [k, [df, dr]] of Object.entries(keys)) {
    const f = Math.min(7, Math.max(0, sq.charCodeAt(0) - 97 + df)), r = Math.min(8, Math.max(1, Number(sq[1]) + dr));
    assert.equal(I.navigate(sq, k).square, String.fromCharCode(97 + f) + r);
  }
});

// ---- 9. episode identity -----------------------------------------------------------------------------
test('episode guard: stale generation / revision / square / fen are rejected; the current one is accepted', () => {
  const st = I.makeInspectorState(3);
  assert.deepEqual(st, {gen: 3, fen: null, square: null, revision: 0});
  const fen = new Chess().fen();
  const ep1 = I.selectSquare(st, fen, 'e2'), a = I.inspect(fen, 'e2', ep1);
  assert.equal(I.acceptInspection(st, a), true);
  const ep2 = I.selectSquare(st, fen, 'g1'), b = I.inspect(fen, 'g1', ep2);
  assert.equal(I.acceptInspection(st, a), false); assert.equal(I.inspectionStaleReason(st, a), 'newer selection or clear');
  assert.equal(I.acceptInspection(st, b), true);
  const moved = structuredClone(b); moved.episode.fen = 'something else'; assert.equal(I.acceptInspection(st, moved), false);
  const sq = structuredClone(b); sq.episode.square = 'e2'; assert.equal(I.acceptInspection(st, sq), false);
  const gen = structuredClone(b); gen.episode.gen = 2; assert.equal(I.acceptInspection(st, gen), false);
  assert.equal(I.acceptInspection(st, I.inspect(fen, 'g1')), false);          // no episode stamped
  assert.equal(I.acceptInspection(st, null), false); assert.equal(I.acceptInspection(st, {}), false);
  I.clearSelection(st); assert.equal(I.acceptInspection(st, b), false); assert.equal(st.square, null);
  const ep3 = I.selectSquare(st, fen, 'g1'), c = I.inspect(fen, 'g1', ep3);
  I.newGeneration(st, 4); assert.equal(I.acceptInspection(st, c), false);
  assert.throws(() => I.newGeneration(st, 2), RangeError);
  // same fen string but a newer click on the same square is still a different episode
  const ep4 = I.selectSquare(st, fen, 'g1'), d = I.inspect(fen, 'g1', ep4); I.selectSquare(st, fen, 'g1');
  assert.equal(I.acceptInspection(st, d), false);
});
test('negative controls: off-board squares and bad input are rejected', () => {
  const fen = new Chess().fen();
  for (const bad of ['i1', 'a9', 'a0', 'A1', 'e', 'e22', '', null, undefined, 5, 'e 4']) {
    assert.throws(() => I.inspect(fen, bad), RangeError, String(bad));
    assert.throws(() => I.selectSquare(I.makeInspectorState(), fen, bad), RangeError);
  }
  assert.throws(() => I.inspect('not a fen', 'e4'));
  assert.throws(() => I.inspect(null, 'e4'));
  assert.throws(() => I.inspectorGeometry(I.inspect(fen, 'e2'), [0, 0]), TypeError);
});

// ---- 10. geometry --------------------------------------------------------------------------------------
const O = [10, 0, 20];
const soupOk = (s, kind) => {
  assert.equal(s.point.length === 0, s.coordIndex.length === 0);
  const segs = []; let cur = [];
  for (const i of s.coordIndex) { if (i === -1) { segs.push(cur); cur = []; } else { assert(Number.isInteger(i) && i >= 0 && i < s.point.length); cur.push(i); } }
  assert.equal(cur.length, 0); assert.equal(segs.length, s.color.length);
  for (const sg of segs) assert(sg.length >= (kind === 'faces' ? 3 : 2));
  for (const p of s.point) { assert.equal(p.length, 3); assert(p.every(Number.isFinite)); }
  for (const c of s.color) assert(c.length === 3 && c.every(v => v >= 0 && v <= 1));
  return segs;
};
test('geometry: halo is a square ring centred exactly on sqPos for all 64 squares', () => {
  const fen = new Chess().fen();
  for (const sq of SQUARES) {
    const g = I.inspectorGeometry(I.inspect(fen, sq), O), segs = soupOk(g.halo, 'faces');
    assert.equal(segs.length, 4);
    const xs = g.halo.point.map(p => p[0]), zs = g.halo.point.map(p => p[2]), [x, , z] = sqPos(sq, O);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - x) < 1e-9); assert.ok(Math.abs((Math.min(...zs) + Math.max(...zs)) / 2 - z) < 1e-9);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 1) < 1e-9);     // outer ring is one square wide
  }
});
test('geometry: up on the keyboard is -Z (away from the camera, rank 8), right is +X', () => {
  const c = sq => { const g = I.inspectorGeometry(I.inspect(new Chess().fen(), sq), O).halo.point; return [g.reduce((a, p) => a + p[0], 0) / g.length, g.reduce((a, p) => a + p[2], 0) / g.length]; };
  const e4 = c('e4'), up = c(I.navigate('e4', 'ArrowUp').square), right = c(I.navigate('e4', 'ArrowRight').square);
  assert.ok(Math.abs(up[1] - e4[1] + 1) < 1e-9 && Math.abs(up[0] - e4[0]) < 1e-9);
  assert.ok(Math.abs(right[0] - e4[0] - 1) < 1e-9 && Math.abs(right[1] - e4[1]) < 1e-9);
});
test('geometry: destination markers on the pin-paradox king (7 quiet diamonds) sit on the board plane at hand-derived centres', () => {
  const g = I.inspectorGeometry(I.inspect(PIN, 'f4'), O), segs = soupOk(g.dest, 'faces');
  assert.equal(segs.length, 7); assert.equal(g.counts.destMarkers, 7);
  assert(segs.every(s => s.length === 4));
  assert(g.dest.color.every(c => c.join() === I.COLORS.quiet.join()));
  // e3 centre: x = 10 + 4 - 3.5 = 10.5 ; z = 20 + 3.5 - 2 = 21.5 ; diamond points at +-0.2
  const xs = g.dest.point.map(p => p[0].toFixed(3) + ',' + p[2].toFixed(3));
  assert(xs.includes('10.500,21.300') && xs.includes('10.700,21.500') && xs.includes('10.500,21.700') && xs.includes('10.300,21.500'));
  assert(g.dest.point.every(p => p[1] < 0.2));
});
test('geometry: capture/castle/en passant/promotion markers use their own colours and rings', () => {
  const ep = I.inspectorGeometry(I.inspect(EP_OK, 'g5'), O);
  assert.deepEqual(ep.dest.color.map(c => c.join()).sort(), [I.COLORS.enPassant.join(), I.COLORS.enPassant.join(), I.COLORS.enPassant.join(), I.COLORS.enPassant.join(), I.COLORS.quiet.join()].sort());
  const cs = I.inspectorGeometry(I.inspect(CASTLE_OK, 'e1'), O);
  assert.equal(cs.dest.color.filter(c => c.join() === I.COLORS.castle.join()).length, 1);
  const pr = I.inspectorGeometry(I.inspect('1n2k3/2P5/8/8/8/8/8/4K3 w - - 0 1', 'c7'), O);
  assert.equal(pr.dest.color.length, 5);                                    // 1 diamond (c8) + 4-face ring (b8)
  assert(pr.dest.color.every(c => c.join() === I.COLORS.promotion.join()));
  const cap = I.inspectorGeometry(I.inspect('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4'), O);   // exd5 + e5
  assert.equal(cap.dest.color.filter(c => c.join() === I.COLORS.capture.join()).length, 4);
  assert.equal(cap.dest.color.filter(c => c.join() === I.COLORS.quiet.join()).length, 1);
});
test('geometry: attacker rays are above the board and dimmed for illegal attackers (f5)', () => {
  const g = I.inspectorGeometry(I.inspect(PIN, 'f5'), O), segs = soupOk(g.rays, 'lines');
  assert.equal(segs.length, 6);                                              // 2 attackers x (shaft + 2 barbs)
  assert(g.rays.point.every(p => p[1] > 0.5));
  // f4 -> f5: f4 centre x = 10+5-3.5 = 11.5 z = 20+3.5-3 = 20.5 ; f5 centre z = 19.5
  const shaft = segs[0].map(i => g.rays.point[i]);
  assert.deepEqual(shaft.map(p => [p[0], p[2]]), [[11.5, 20.5], [11.5, 19.5]]);
  assert(g.rays.color.every(c => [I.COLORS.attackerDim, I.COLORS.controlW, I.COLORS.controlB].some(k => k.join() === c.join())));
  assert(g.rays.color.some(c => c.join() === I.COLORS.attackerDim.join()));
  const occupied = I.inspectorGeometry(I.inspect('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'd5'), O);
  assert.equal(occupied.rays.color.filter(c => c.join() === I.COLORS.attacker.join()).length, 3);   // Pe4 is the enemy attacker (1 arrow)
});
test('geometry: pin ray has a distinct style (low, amber, ticked) from attacker rays', () => {
  const g = I.inspectorGeometry(I.inspect(PIN, 'e7'), O), segs = soupOk(g.pin, 'lines');
  assert.equal(segs.length, 1 + 7);                                          // king->pinner polyline + one tick per ray square
  const main = segs[0].map(i => g.pin.point[i]);
  assert.deepEqual(main.map(p => [p[0], p[2]]).slice(0, 2), [[10.5, 16.5], [10.5, 17.5]]);   // e8 then e7: x=10+4-3.5, z=20+3.5-7 / -6
  assert.equal(main.length, 8); assert(g.pin.point.every(p => p[1] < 0.3));
  assert(g.pin.color.every(c => c.join() === I.COLORS.pinned.join()));
  const kr = I.inspectorGeometry(I.inspect(PIN, 'e1'), O);
  assert(kr.pin.color.every(c => c.join() === I.COLORS.pinning.join()));
  assert.notDeepEqual(I.COLORS.pinned, I.COLORS.attacker); assert.notDeepEqual(I.COLORS.pinned, I.COLORS.pinning);
  assert.equal(I.inspectorGeometry(I.inspect(PIN, 'f4'), O).pin.point.length, 0);
});
test('geometry: null inspection clears everything', () => {
  const e = I.inspectorGeometry(null, O);
  for (const k of ['halo', 'dest', 'rays', 'pin']) assert.equal(e[k].point.length, 0);
  assert.deepEqual(e.counts, {destMarkers: 0, rayLines: 0, pinLines: 0});
});
test('queen d4 (Ke1, ke8) has the hand-counted 27 legal destinations and 27 markers', () => {
  // d-file: d1 d2 d3 d5 d6 d7 d8 = 7; rank 4: a4 b4 c4 e4 f4 g4 h4 = 7; a1-h8 diagonal: a1 b2 c3 e5 f6 g7 h8 = 7;
  // a7-g1 diagonal: a7 b6 c5 e3 f2 g1 = 6. Neither king lies on a queen line and neither is in check -> 27.
  const ins = I.inspect('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', 'd4');
  assert.equal(ins.legal.destinations.length, 27);
  assert.equal(I.inspectorGeometry(ins, O).counts.destMarkers, 27);
});

// ---- 11. pre-created X3D shapes + SAI update -----------------------------------------------------------
test('inspectorXml: four pre-created shapes, all pointerEvents=false, stable DEF names, no geometry yet', () => {
  const xml = I.inspectorXml(O, {def: 'b3'});
  assert.equal((xml.match(/<Shape\b/g) || []).length, 4);
  assert.equal((xml.match(/<Shape\b[^>]*pointerEvents='false'/g) || []).length, 4);
  assert.match(xml, /<X3D profile='Interchange' version='4.0'><head><component name='Rendering'/);
  const names = I.inspectorNodeNames('b3');
  for (const p of ['halo', 'dest', 'rays', 'pin']) for (const n of Object.values(names[p])) assert(xml.includes(`DEF='${n}'`), n);
  assert.equal((xml.match(/<IndexedFaceSet/g) || []).length, 2); assert.equal((xml.match(/<IndexedLineSet/g) || []).length, 2);
  assert.throws(() => I.inspectorXml(O, {def: "x' onload='"}), TypeError);
  assert.throws(() => I.inspectorXml([0, 0]), TypeError);
});
test('applyInspectorGeometry writes point/coordIndex/color through SAI and resets empties to the placeholder', () => {
  const nodes = new Map(), X3D = {};
  for (const t of ['MFVec3f', 'MFInt32', 'MFColor', 'SFVec3f', 'SFColor']) X3D[t] = class { constructor(...a) { this.t = t; this.a = a; } };
  const scene = {getNamedNode: n => { if (!nodes.has(n)) nodes.set(n, {}); return nodes.get(n); }};
  const g = I.inspectorGeometry(I.inspect(PIN, 'f4'), O);
  I.applyInspectorGeometry(scene, g, X3D, 'q');
  const names = I.inspectorNodeNames('q');
  assert.equal(nodes.get(names.dest.coord).point.a.length, g.dest.point.length);
  assert.deepEqual(nodes.get(names.dest.geometry).coordIndex.a, g.dest.coordIndex);
  assert.equal(nodes.get(names.dest.color).color.a.length, 7);
  assert.deepEqual(nodes.get(names.pin.geometry).coordIndex.a, [-1]);          // empty part -> placeholder
  I.applyInspectorGeometry(scene, I.inspectorGeometry(null, O), X3D, 'q');
  assert.deepEqual(nodes.get(names.dest.geometry).coordIndex.a, [-1]);
});
const validatorOutput = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-x3d-')), 'report.json');
const tmpDir = path.dirname(validatorOutput);
function writeDoc(name, xml) { const f = path.join(tmpDir, name + '.x3d'); fs.writeFileSync(f, projectPortableX3D(xml, {title: 'inspector ' + name}).xml); return f; }
test('X3D 4.0 validity: empty and populated documents pass the pinned XSD + semantic validator; corrupt copies fail', () => {
  const cases = {
    empty: I.inspectorXml(O),
    pin: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect(PIN, 'e7'), O)}),
    f5: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect(PIN, 'f5'), O)}),
    ep: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect(EP_OK, 'g5'), O)}),
    castle: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect(CASTLE_OK, 'e1'), O)}),
    promo: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect('1n2k3/2P5/8/8/8/8/8/4K3 w - - 0 1', 'c7'), O)}),
    queen: I.inspectorXml(O, {def: 'insp7', geometry: I.inspectorGeometry(I.inspect('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', 'd4'), O)}),
    battery: I.inspectorXml(O, {geometry: I.inspectorGeometry(I.inspect('4k3/8/8/8/8/8/4R3/4Q1K1 w - - 0 1', 'e1'), O)}),
  };
  const files = Object.entries(cases).map(([n, x]) => writeDoc(n, x));
  const good = spawnSync(PY, [path.join(ROOT, 'tools/validate_x3d.py'), '--output', validatorOutput, ...files], {encoding: 'utf8'});
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const rep = JSON.parse(fs.readFileSync(validatorOutput, 'utf8'));
  assert.equal(rep.files.length, files.length); assert(rep.files.every(f => f.status === 'pass' && f.xsd.status === 'pass' && f.semantic.status === 'pass'));
  const bad = {
    point: cases.pin.replace(/point='[^']*'/, "point='1 2 notanumber'"),
    index: cases.pin.replace(/coordIndex='[^']*'/, "coordIndex='0 1 two -1'"),
    node: cases.pin.replace('<Coordinate', '<Cordinate'),
  };
  for (const [n, x] of Object.entries(bad)) {
    const f = writeDoc('bad-' + n, x);
    const r = spawnSync(PY, [path.join(ROOT, 'tools/validate_x3d.py'), '--output', path.join(tmpDir, 'bad.json'), f], {encoding: 'utf8'});
    assert.notEqual(r.status, 0, 'corrupt ' + n + ' was accepted');
  }
});

// ---- 12. 100 random legal positions vs python-chess ---------------------------------------------------------
test('python-chess agreement: 100 seeded positions x 64 squares (moves+flags, attackers, attack legality, pins, enemy-attacked)', () => {
  const expectPath = path.join(ROOT, 'tools/inspector-expect.json');
  const regen = spawnSync(PY, [path.join(ROOT, 'tools/inspector_expect.py')], {encoding: 'utf8', maxBuffer: 1 << 28});
  assert.equal(regen.status, 0, regen.stderr);
  assert.equal(regen.stdout, fs.readFileSync(expectPath, 'utf8'), 'committed expectation file is not what the fixed-seed generator produces');
  const doc = JSON.parse(regen.stdout);
  assert.equal(doc.positions.length, 100); assert.equal(doc.positions[0].fen, new Chess().fen());
  const cov = {ep: 0, castle: 0, promotion: 0, check: 0, pinned: 0, illegalAttack: 0, kingTarget: 0};
  const flagsOf = (m) => [m.capture && 'capture', m.enPassant && 'en_passant', m.castle && 'castle_' + m.castle, m.promotion && 'promotion'].filter(Boolean).sort();
  const compare = (rec, sq, ins) => {
    const e = rec.sq[sq], diffs = [];
    const moves = Object.fromEntries(ins.legal.moves.map(m => [m.uci, flagsOf(m)]));
    if (JSON.stringify(Object.entries(moves).sort()) !== JSON.stringify(Object.entries(e.moves).sort())) diffs.push('moves');
    if (JSON.stringify(froms(ins.attackedBy.w)) !== JSON.stringify([...e.att.w].sort()) || JSON.stringify(froms(ins.attackedBy.b)) !== JSON.stringify([...e.att.b].sort())) diffs.push('attackers');
    for (const a of [...ins.attackedBy.w, ...ins.attackedBy.b]) if (e.legal[a.square] !== a.attackLegalToPlay) diffs.push('legal ' + a.square);
    if (ins.piece) { if (ins.pin.pinned !== e.pinned) diffs.push('pinned'); } else if ('pinned' in e) diffs.push('pinned on empty');
    if (ins.kingSafety.attackedByEnemy !== e.enemy) diffs.push('enemy');
    if (ins.position.inCheck !== rec.check || ins.position.checkers.join() !== rec.checkers.join() || ins.turn !== rec.turn) diffs.push('position');
    return diffs;
  };
  for (const rec of doc.positions) {
    const grid = controlGrid(new Chess(rec.fen));
    if (rec.check) cov.check++;
    for (const [i, sq] of SQUARES.entries()) {
      const ins = I.inspect(rec.fen, sq);
      assert.deepEqual(compare(rec, sq, ins), [], rec.fen + ' ' + sq);
      assert.equal(ins.control.balance, grid[i]); assert.equal(ins.control.balance, rec.sq[sq].att.w.length - rec.sq[sq].att.b.length);
      for (const m of ins.legal.moves) { if (m.enPassant) cov.ep++; if (m.castle) cov.castle++; if (m.promotion) cov.promotion++; }
      for (const d of ins.legal.destinations) if (d.promotions.length) assert.deepEqual(d.promotions, ['b', 'n', 'q', 'r']);
      if (ins.piece && ins.pin.pinned) cov.pinned++;
      for (const a of [...ins.attackedBy.w, ...ins.attackedBy.b]) { if (a.attackLegalToPlay === false) cov.illegalAttack++; if (a.attackLegalToPlay === null) cov.kingTarget++; }
    }
  }
  assert(cov.ep >= 10 && cov.castle >= 10 && cov.promotion >= 40 && cov.check >= 10 && cov.pinned >= 5 && cov.illegalAttack >= 100 && cov.kingTarget >= 10, JSON.stringify(cov));
  console.log('random coverage:', JSON.stringify(cov));
  // negative controls: corrupt one expectation at a time; the comparer must flag each
  const rec = structuredClone(doc.positions.find(r => Object.values(r.sq).some(e => Object.keys(e.moves).length > 2)));
  const sq = Object.keys(rec.sq).find(s => Object.keys(rec.sq[s].moves).length > 2), ins = I.inspect(rec.fen, sq);
  assert.deepEqual(compare(rec, sq, ins), []);
  const m = structuredClone(rec); delete m.sq[sq].moves[Object.keys(m.sq[sq].moves)[0]]; assert.notDeepEqual(compare(m, sq, ins), []);
  const f = structuredClone(rec); f.sq[sq].moves[Object.keys(f.sq[sq].moves)[0]].push('capture'); assert.notDeepEqual(compare(f, sq, ins), []);
  const a = structuredClone(doc.positions[0]); a.sq.f3.att.w.push('a1'); assert.notDeepEqual(compare(a, 'f3', I.inspect(a.fen, 'f3')), []);
  const t = structuredClone(doc.positions[0]); t.turn = 'b'; assert.notDeepEqual(compare(t, 'e2', I.inspect(t.fen, 'e2')), []);
  // and a corrupted FEN (ep rights stripped from the exposure position) changes the answer the comparer sees
  assert.notDeepEqual(dests(EP_OK, 'g5'), dests('k7/8/8/r4pPK/8/8/8/8 w - - 0 1', 'g5'));
  assert.notDeepEqual(dests(CASTLE_OK, 'e1'), dests('rk6/8/8/8/8/8/8/4K2R w - - 0 1', 'e1'));
});

// ---- 13. review fixes: defenders / pawn control are not 'illegal', browser shortcuts are not ours -----------
test('defender: a move onto an own piece does not exist, so attackLegalToPlay is null and the ray is not dimmed', () => {
  const fen = '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1';              // Re1 defends Ne4 along the open e-file
  const ins = I.inspect(fen, 'e4');
  assert.equal(ins.defenders.length, 1); assert.equal(ins.defenders[0].square, 'e1');
  assert.equal(ins.defenders[0].attackLegalToPlay, null); assert.equal(ins.defenders[0].legalBasis, 'own-piece-on-target');
  const g = I.inspectorGeometry(ins, O);
  assert(g.rays.color.length === 3 && g.rays.color.every(c => c.join() === I.COLORS.defender.join()), JSON.stringify(g.rays.color));
  // the enemy side still dims a genuinely illegal attacker (pinned knight e7 -> f5 in the pin position)
  assert(I.inspectorGeometry(I.inspect(PIN, 'f5'), O).rays.color.some(c => c.join() === I.COLORS.attackerDim.join()));
});
test('pawn diagonal onto an empty square is control, not a move: null/not dimmed, except a real en passant target', () => {
  const d3 = I.inspect('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'd3').attackedBy.w[0];   // Pe2 controls d3 (hand: diagonal)
  assert.equal(d3.square, 'e2'); assert.equal(d3.attackLegalToPlay, null); assert.equal(d3.legalBasis, 'pawn-capture-needs-a-target');
  assert(I.inspectorGeometry(I.inspect('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'd3'), O).rays.color.every(c => c.join() === I.COLORS.controlW.join()));
  // black pawn controlling an empty square while it is White's turn: also null (not a move for anyone right now)
  assert.equal(I.inspect('4k3/3p4/8/8/8/8/8/4K3 w - - 0 1', 'c6').attackedBy.b[0].attackLegalToPlay, null);
  // en passant target keeps real answers (legal in the clear twin, illegal in the rank-exposure position)
  assert.equal(I.inspect(EP_OK, 'f6').attackedBy.w[0].attackLegalToPlay, true);
  assert.equal(I.inspect(EP_BAD, 'f6').attackedBy.w[0].attackLegalToPlay, false);
  // a pawn capture of an enemy piece is still a real question
  assert.equal(I.inspect('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'd5').attackedBy.w[0].attackLegalToPlay, true);
  // the same pawn that is pinned cannot capture: pawn e4 pinned on the e-file cannot take d5 (hand: leaves the file)
  assert.equal(I.inspect('4r1k1/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'd5').attackedBy.w[0].attackLegalToPlay, false);
});
test('navigate: Ctrl/Meta/Alt/IME chords (Ctrl+S, Ctrl+W, Cmd+D, Alt+Left) are not handled; plain and Shift keys are', () => {
  for (const m of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {isComposing: true}]) {
    for (const k of ['s', 'w', 'd', 'a', 'ArrowLeft']) assert.deepEqual(I.navigate('e4', k, m), {square: 'e4', handled: false, changed: false}, JSON.stringify(m) + k);
  }
  assert.equal(I.navigate('e4', 'ArrowUp', {shiftKey: true, ctrlKey: false}).square, 'e5');
  assert.equal(I.navigate('e4', 'ArrowUp', null).square, 'e5');
});

test('LEGEND names every relation and keeps attack, legality and mobility apart', () => {
  for (const k of ['geometricAttack', 'legalMove', 'attackLegalToPlay', 'defenders', 'control', 'pin', 'xray', 'kingSafety', 'destinations', 'rays', 'pinRay']) assert(typeof I.LEGEND[k] === 'string' && I.LEGEND[k].length > 20, k);
  assert.match(I.LEGEND.control, /not legal mobility/); assert.match(I.LEGEND.xray, /not a legal capture sequence/);
  assert.match(I.LEGEND.geometricAttack, /pins and checks are ignored/);
  assert.throws(() => { 'use strict'; I.LEGEND.pin = 'x'; }, TypeError);
  assert.equal(I.inspect(PIN, 'f5').legend, I.LEGEND);
});

if (failures.length) { console.error('FAIL ' + failures.length + ' of ' + (passed + failures.length) + '\n' + failures.join('\n')); process.exit(1); }
console.log(JSON.stringify({status: 'pass', tests: passed, scope: 'inspector relations vs hand-derived answers, python-chess fixed-seed positions, generated X3D vs pinned validator; no browser/X_ITE execution'}));
