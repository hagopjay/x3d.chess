// Deterministic tests of actual transport code; fake workers are failure/race controls, not strength benchmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../viewer/vendor/chess.js';
import { WasmEnginePool } from '../viewer/js/engine-pool.js';
import { WasmTransport } from '../viewer/js/wasm-transport.js';
import { ReplayTransport } from '../viewer/js/replay.js';
import { SseTransport } from '../viewer/js/sse-transport.js';
import { terminalResult } from '../viewer/js/transport.js';

const START = new Chess().fen(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate) { const end = Date.now() + 1000; while (!predicate()) { if (Date.now() > end) throw new Error('Control did not settle'); await sleep(1); } }
class ImmediateWorker {
  constructor({ holdUci = false, holdGo = false, best = 'e2e4', info = 'info depth 4 score cp 37 lowerbound nodes 123' } = {}) {
    Object.assign(this, { holdUci, holdGo, best, info }); this.commands = []; this.dead = false;
  }
  emit(data) { this.onmessage?.({ data }); }
  postMessage(command) {
    this.commands.push(command);
    if (command === 'uci' && !this.holdUci) { this.emit('id name Immediate test worker'); this.emit('uciok'); }
    if (command === 'isready') this.emit('readyok');
    if (command.startsWith('go ') && !this.holdGo) { if (this.info) this.emit(this.info); this.emit('bestmove ' + this.best); }
  }
  terminate() { this.dead = true; }
}
function fixture(options = {}, behavior = {}) {
  const workers = [];
  const pool = new WasmEnginePool({ size: 1, initTimeoutMs: 100, searchTimeoutMs: 100,
    workerFactory: () => { const w = new ImmediateWorker(behavior); workers.push(w); return w; }, ...options });
  return { pool, workers };
}

test('immediate UCI replies cannot race waiter registration; scores and bounds become White-positive', async () => {
  const { pool, workers } = fixture({}, { best: 'g8f6' }); await pool.init();
  const chess = new Chess(); chess.move('e4');
  const score = await pool.search(chess.fen(), { initialFen: START, moves: ['e2e4'], gameKey: 'g0:1' });
  assert.equal(score.cp, -37); assert.equal(score.score_bound, 'upperbound'); assert.equal(score.eval_fen, chess.fen());
  assert.equal(score.nodes, 123); assert.equal(score.uci, 'g8f6'); assert.deepEqual(pool.engineNames, ['Immediate test worker']);
  assert.equal(workers[0].commands.at(-2), 'position fen ' + START + ' moves e2e4'); pool.terminate();
});

test('position commands retain repetition history and reset only when a worker changes games', async () => {
  const { pool, workers } = fixture(); await pool.init(); const chess = new Chess();
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8']; for (const uci of moves) chess.move({ from: uci.slice(0, 2), to: uci.slice(2) });
  await pool.search(chess.fen(), { initialFen: START, moves, gameKey: 'g0:1' });
  await pool.search(chess.fen(), { initialFen: START, moves, gameKey: 'g0:1' });
  assert.equal(workers[0].commands.filter(x => x === 'ucinewgame').length, 1);
  assert(workers[0].commands.includes('position fen ' + START + ' moves ' + moves.join(' ')));
  await pool.search(chess.fen(), { initialFen: START, moves, gameKey: 'g1:1' });
  assert.equal(workers[0].commands.filter(x => x === 'ucinewgame').length, 2); pool.terminate();
});

test('bounded queue rejects excess work; stop rejects active and queued work without leaking leases', async () => {
  const { pool, workers } = fixture({ queueLimit: 1 }, { holdGo: true }); await pool.init();
  const first = pool.search(START); await until(() => workers[0].commands.some(x => x.startsWith('go ')));
  const second = pool.search(START); const third = pool.search(START);
  await assert.rejects(third, /queue is full/);
  const settled = Promise.allSettled([first, second]); pool.terminate();
  assert((await settled).every(x => x.status === 'rejected' && x.reason.name === 'AbortError'));
  assert.equal(pool.queue.length, 0); assert.equal(pool.free.length, 0); assert(workers[0].dead);
});

test('worker errors reject active and queued requests and expose a failed pool', async () => {
  const { pool, workers } = fixture({}, { holdGo: true }); await pool.init();
  const first = pool.search(START); await until(() => workers[0].commands.some(x => x.startsWith('go ')));
  const second = pool.search(START), result = Promise.allSettled([first, second]);
  workers[0].onerror({ message: 'planted WASM load error', preventDefault() {} });
  assert((await result).every(x => x.status === 'rejected' && /planted/.test(x.reason.message)));
  assert.equal(pool.state, 'error');
});

test('initialization and search timeouts settle instead of hanging or recycling a desynchronized worker', async () => {
  const init = fixture({ initTimeoutMs: 15 }, { holdUci: true }); await assert.rejects(init.pool.init(), /timed out/); assert(init.workers[0].dead);
  const search = fixture({ searchTimeoutMs: 15 }, { holdGo: true }); await search.pool.init();
  await assert.rejects(search.pool.search(START), /timed out/); assert(search.workers[0].dead);
  await assert.rejects(search.pool.search(START), /timed out/);
});

test('stop during initialization rejects its pending handshake', async () => {
  const { pool } = fixture({}, { holdUci: true }); const init = pool.init(); pool.terminate();
  await assert.rejects(init, { name: 'AbortError' });
});

test('missing score stays null, UCI no-move tokens are normalized, malformed bestmove fails', async () => {
  for (const best of ['0000', '(none)']) {
    const { pool } = fixture({}, { best, info: '' }); await pool.init(); const result = await pool.search(START);
    assert.equal(result.uci, null); assert.equal(result.cp, null); assert.equal(result.score_bound, null); pool.terminate();
  }
  const { pool } = fixture({}, { best: 'not-a-move' }); await pool.init();
  await assert.rejects(pool.search(START), /invalid UCI/); assert(pool.closed);
});

test('invalid options and newline command injection are rejected before engine work', async () => {
  assert.throws(() => new WasmEnginePool({ size: 0 }), /Worker count/);
  const { pool } = fixture(); await pool.init();
  await assert.rejects(pool.search(START + '\nquit'), /FEN line/);
  await assert.rejects(pool.search(START, { moves: ['e2e4\nquit'] }), /history/);
  await assert.rejects(pool.search(START, { depth: Infinity }), /Search depth/); pool.terminate();
  const wasm = new WasmTransport(() => {}); await assert.rejects(wasm.start({ boards: 65 }), /Board count/);
  const replay = new ReplayTransport(() => {}); await assert.rejects(replay.start({ intervalMs: 0 }), /Replay interval/);
});

class LegalPool {
  constructor() { this.size = 1; this.calls = []; this.closed = false; }
  async init() {}
  async search(fen, options) {
    this.calls.push({ fen, ...options, moves: options.moves.slice() });
    const chess = new Chess(fen), move = chess.moves({ verbose: true })[0];
    return { uci: move.from + move.to + (move.promotion || ''), cp: 45, mate: null, score_bound: 'exact', depth: 4, nodes: 10 };
  }
  terminate() { this.closed = true; }
}
test('holdGame freezes a game at its current FEN until released, then play resumes', async () => {
  const events = [], pool = new LegalPool(), transport = new WasmTransport(e => events.push(e), { poolFactory: () => pool });
  await transport.start({ boards: 1, seed: 1 }); await until(() => events.some(e => e.type === 'move'));
  const held = transport.holdGame('g0'); const before = events.filter(e => e.type === 'move').length;
  await new Promise(r => setTimeout(r, 400));
  const frozen = events.filter(e => e.type === 'move').length;
  assert(frozen - before <= 1, 'at most the in-flight move may land after the hold');
  const fen = transport.games[0].chess.fen(); await new Promise(r => setTimeout(r, 400));
  assert.equal(transport.games[0].chess.fen(), fen, 'a held game must not advance'); assert.equal(events.filter(e => e.type === 'move').length, frozen);
  assert.throws(() => transport.holdGame('g9'), /Unknown game/);
  transport.releaseGame('g0'); await until(() => events.filter(e => e.type === 'move').length > frozen); await transport.stop();
});
test('WASM move is legal, carries generation/seq, and binds its score to the pre-move FEN and ply', async () => {
  const events = [], pool = new LegalPool(), transport = new WasmTransport(e => events.push(e), { poolFactory: () => pool });
  await transport.start({ boards: 1, seed: 1 }); await until(() => events.some(e => e.type === 'move')); await transport.stop();
  const snapshot = events.find(e => e.type === 'snapshot_game'), move = events.find(e => e.type === 'move');
  assert.equal(snapshot.generation, 1); assert.equal(snapshot.seq, 1); assert.equal(snapshot.eval_cp, null);
  assert.equal(move.generation, 1); assert.equal(move.seq, 2); assert.equal(move.state, 'playing');
  assert.equal(move.eval_fen, snapshot.fen); assert.equal(move.eval_ply, 0); assert.equal(move.ply, 1);
  const chess = new Chess(snapshot.fen); chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] });
  assert.equal(chess.fen(), move.fen); assert.equal(pool.calls[0].gameKey, 'g0:1'); assert(pool.closed);
  assert.equal(pool.calls[0].initialFen, START);
  const restored = new Chess(pool.calls[0].initialFen);
  for (const uci of pool.calls[0].moves) restored.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  assert.equal(restored.fen(), snapshot.fen, 'Engine history reconstructs the actual seeded opening position');
  assert.equal(transport.timers.size, 0);
});

test('WASM no-move response for a live position is an error, never a fabricated drawn game', async () => {
  const pool = new LegalPool(); pool.search = async () => ({ uci: null, cp: null, mate: null });
  const events = [], transport = new WasmTransport(e => events.push(e), { poolFactory: () => pool });
  await transport.start({ boards: 1 }); await until(() => transport.state === 'error');
  assert.match(events.at(-1).message, /non-terminal/); assert(!events.some(e => e.type === 'game_complete')); await transport.stop();
});

test('concurrent starts create only the surviving worker pool', async () => {
  let count = 0; const transport = new WasmTransport(() => {}, { poolFactory: () => { count++; return new LegalPool(); } });
  await Promise.all([transport.start({ boards: 1 }), transport.start({ boards: 1 })]); await transport.stop(); assert.equal(count, 1);
});

test('replay stop cancels pending board staggering; cap completion is identified and generations restart', async () => {
  const events = [], transport = new ReplayTransport(e => events.push(e)); await transport.start({ boards: 4, intervalMs: 16 });
  await sleep(20); await transport.stop(); const stoppedCount = events.length; await sleep(35); assert.equal(events.length, stoppedCount);
  assert.equal(transport.timers.size, 0);
  await transport.start({ boards: 1, intervalMs: 60000 }); const game = transport.games[0]; game.ply = 140; transport._step(game);
  const complete = events.find(e => e.type === 'game_complete'); assert.equal(complete.reason, 'replay_cap'); assert(complete.adjudicated);
  const fresh = events.filter(e => e.type === 'snapshot_game').at(-1); assert.equal(fresh.generation, 2); assert.equal(fresh.seq, 1); await transport.stop();
});

test('draw policy identifies retained repetition history and checkmate takes precedence over the move cap', () => {
  const chess = new Chess(); for (let i = 0; i < 2; i++) for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) chess.move(move);
  assert(chess.isThreefoldRepetition()); const ending = terminalResult(chess, 8, 140, 'cap');
  assert.equal(ending.reason, 'threefold'); assert(ending.adjudicated); assert.equal(ending.draw_policy, 'claim_current_position');
  assert.equal(new Chess(chess.fen()).isThreefoldRepetition(), false, 'FEN alone omits the repetition history');
  const mate = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 100 1');
  assert.equal(terminalResult(mate, 200, 200, 'cap').reason, 'checkmate');
});

test('mandatory seventy-five move and fivefold results take precedence over the spectator claim policy', () => {
  const chess = new Chess(); for (let i = 0; i < 4; i++) for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) chess.move(move);
  const repeated = terminalResult(chess, 16, 200, 'cap'); assert.equal(repeated.reason, 'fivefold'); assert.equal(repeated.adjudicated, false);
  const clock = new Chess('7k/8/8/8/8/8/6R1/K7 w - - 150 76');
  const timed = terminalResult(clock, 0, 200, 'cap'); assert.equal(timed.reason, 'seventyfive_move'); assert.equal(timed.adjudicated, false);
});

test('browser current-position draw policy intentionally waits for prospective repetition and fifty-move claims', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) repeated.move(move);
  const before = repeated.fen(), length = repeated.history().length;
  assert.equal(terminalResult(repeated, 7, 200, 'cap'), null);
  repeated.move('Ng8'); assert.equal(terminalResult(repeated, 8, 200, 'cap').reason, 'threefold'); repeated.undo();
  assert.equal(repeated.fen(), before); assert.equal(repeated.history().length, length);
  const clock = new Chess('7k/8/8/8/8/8/6R1/K7 w - - 99 76');
  assert.equal(terminalResult(clock, 0, 200, 'cap'), null);
  clock.move('Rg1'); const ending = terminalResult(clock, 1, 200, 'cap');
  assert.equal(ending.reason, 'fifty_move'); assert(ending.adjudicated); assert.equal(ending.draw_policy, 'claim_current_position');
});

class EventSourceControl { constructor() { this.readyState = 0; this.closed = false; } close() { this.closed = true; } }
test('SSE reports retry/reconnect, rejects malformed data, and ignores old callbacks after restart/stop', async () => {
  const events = [], sources = [], transport = new SseTransport(e => events.push(e), { eventSourceFactory: () => { const s = new EventSourceControl(); sources.push(s); return s; } });
  await transport.start(); const old = sources[0]; await transport.start(); const current = sources[1]; assert(old.closed);
  old.onmessage({ data: JSON.stringify({ type: 'snapshot_game', game_id: 'g0' }) }); assert(!events.some(e => e.type === 'snapshot_game'));
  current.onopen(); assert.equal(transport.state, 'running'); current.onerror(); assert.equal(transport.state, 'retrying'); current.onopen();
  current.onmessage({ data: JSON.stringify({ type: 'snapshot_game', game_id: 'g0', generation: 4, seq: 10 }) });
  assert.equal(events.at(-1).generation, 4); assert.equal(events.at(-1).seq, 10);
  current.onmessage({ data: '{' }); assert(current.closed); assert.equal(transport.state, 'error');
  const count = events.length; current.onmessage({ data: '{}' }); assert.equal(events.length, count); await transport.stop();
  await assert.rejects(transport.start({ url: 'javascript:alert(1)' }), /HTTP/);
});
