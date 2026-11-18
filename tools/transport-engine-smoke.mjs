// Exercise the actual vendored Stockfish JS/WASM through the same UCI pool.
// Node subprocess adapter is independent of browser Worker startup/rendering.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Chess } from '../viewer/vendor/chess.js';
import { WasmEnginePool } from '../viewer/js/engine-pool.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = path.join(root, 'viewer/vendor/stockfish/stockfish-19-lite-single.js');
class NodeUciWorker {
  constructor() {
    this.closed = false; this.child = spawn(process.execPath, [engine], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.errors = '';
    readline.createInterface({ input: this.child.stdout }).on('line', line => this.onmessage?.({ data: line }));
    this.child.stderr.on('data', chunk => { this.errors += chunk.toString(); });
    this.child.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
    this.child.on('exit', (code, signal) => { if (!this.closed) this.onerror?.({ message: `Stockfish exited ${code ?? signal}: ${this.errors.slice(-500)}`, preventDefault() {} }); });
  }
  postMessage(command) { this.child.stdin.write(command + '\n'); }
  terminate() { this.closed = true; this.child.kill(); }
}
const pool = new WasmEnginePool({ size: 2, workerFactory: () => new NodeUciWorker(), initTimeoutMs: 15000, searchTimeoutMs: 20000 });
const report = { schema: 'x3dchess.transport-engine-check/1', status: 'not_run', created_utc: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  scope: 'Executed vendored Stockfish JS/WASM under Node through the actual UCI pool. Browser Worker/WASM fetch, renderer pixels, strength and hardware performance are not established.', cases: [] };
try {
  await pool.init(); report.engine_names = pool.engineNames;
  const cases = [
    { id: 'white-mate-in-one', fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', sign: 1 },
    { id: 'black-mate-in-one', fen: '8/8/8/8/8/6k1/5q2/7K b - - 0 1', sign: -1 },
  ];
  await Promise.all(cases.map(async c => {
    const result = await pool.search(c.fen, { depth: 8, gameKey: c.id });
    const board = new Chess(c.fen); board.move({ from: result.uci.slice(0, 2), to: result.uci.slice(2, 4), promotion: result.uci[4] });
    assert(board.isCheckmate(), 'Engine bestmove must produce checkmate on this known-answer fixture');
    assert.equal(Math.sign(result.mate), c.sign); assert.equal(Math.abs(result.mate), 1);
    report.cases.push({ id: c.id, fen: c.fen, result, legal: true, resulting_checkmate: true, resulting_fen: board.fen() });
  }));
  const board = new Chess(), history = ['e2e4', 'e7e5', 'g1f3'];
  for (const move of history) board.move({ from: move.slice(0, 2), to: move.slice(2) });
  const fen = board.fen(), result = await pool.search(fen, { depth: 5, initialFen: new Chess().fen(), moves: history, gameKey: 'history-fixture' });
  board.move({ from: result.uci.slice(0, 2), to: result.uci.slice(2, 4), promotion: result.uci[4] });
  report.cases.push({ id: 'history-position', fen, history, result, legal: true, resulting_fen: board.fen() });
  report.searches = pool.searches; report.nodes = pool.nodes;
  report.source_sha256 = Object.fromEntries(['viewer/js/engine-pool.js', 'viewer/vendor/chess.js',
    'viewer/vendor/stockfish/stockfish-19-lite-single.js', 'viewer/vendor/stockfish/stockfish-19-lite-single.wasm',
    'tools/transport-engine-smoke.mjs'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
  report.status = 'pass';
} finally { pool.terminate(); }
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
