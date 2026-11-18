#!/usr/bin/env node
/** Verify runtime bytes and query the real vendored Stockfish WASM under Node.
 * This is not browser-worker, native X_ITE, GPU or game-strength evidence.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Chess } from "../viewer/vendor/chess.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const need = (ok, message) => { if (!ok) throw new Error(message); };
const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u.length === 5 ? { promotion: u[4] } : {}) });

class UciProcess {
  constructor(executable) {
    this.lines = []; this.waiters = new Set(); this.stderr = ""; this.buffer = ""; this.closed = false;
    this.child = spawn(process.execPath, [executable], { cwd: path.dirname(executable), stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      for (;;) {
        const at = this.buffer.indexOf("\n"); if (at < 0) break;
        const line = this.buffer.slice(0, at).trim(); this.buffer = this.buffer.slice(at + 1);
        this.lines.push(line); if (this.lines.length > 1000) this.lines.shift();
        for (const w of [...this.waiters]) if (w.predicate(line)) { clearTimeout(w.timer); this.waiters.delete(w); w.resolve(line); }
      }
    });
    this.child.stderr.setEncoding("utf8"); this.child.stderr.on("data", (s) => { this.stderr = (this.stderr + s).slice(-5000); });
    const fail = (e) => { this.closed = true; for (const w of this.waiters) { clearTimeout(w.timer); w.reject(e); } this.waiters.clear(); };
    this.child.on("error", fail); this.child.on("exit", (code, signal) => fail(new Error(`Engine exited ${code}/${signal}: ${this.stderr}`)));
  }
  command(command, predicate, timeout = 20000) {
    need(!this.closed, "Engine is closed");
    // Register before stdin.write: even a synchronous/very fast reply has a waiter.
    const pending = new Promise((resolve, reject) => {
      const w = { predicate, resolve, reject };
      w.timer = setTimeout(() => { this.waiters.delete(w); reject(new Error(`UCI timeout: ${command}`)); }, timeout);
      this.waiters.add(w);
    });
    this.child.stdin.write(command + "\n"); return pending;
  }
  async ready() { await this.command("isready", (s) => s === "readyok"); }
  async search(fen, depth = 6) {
    this.child.stdin.write("ucinewgame\n"); await this.ready();
    this.child.stdin.write("position fen " + fen + "\n");
    const before = this.lines.length;
    const started = performance.now();
    const best = await this.command("go depth " + depth, (s) => /^bestmove\s/.test(s));
    const rows = this.lines.slice(before), infos = rows.filter((s) => /^info\b/.test(s));
    const score = [...infos].reverse().map((s) => /\bscore (cp|mate) (-?\d+)/.exec(s)).find(Boolean);
    return { fen, depth, uci: best.split(/\s+/)[1], score: score ? { kind: score[1], value: Number(score[2]), perspective: "side-to-move" } : null,
      elapsed_ms: performance.now() - started, last_info: infos.at(-1) || null };
  }
  async perft(depth) {
    this.child.stdin.write("position startpos\n");
    const line = await this.command("go perft " + depth, (s) => /^Nodes searched:\s*\d+/.test(s));
    return Number(/\d+/.exec(line)[0]);
  }
  close() { if (!this.closed) { this.child.stdin.write("quit\n"); this.child.stdin.end(); this.child.kill(); } }
}

async function main() {
  const started = new Date().toISOString(), files = {}, runtime = path.join(ROOT, "viewer/vendor/x_ite");
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, "ORIGIN.json"), "utf8"));
  need(manifest.version === "16.6.1", "Unexpected X_ITE version");
  for (const [name, expected] of Object.entries(manifest.files_sha256)) {
    need(!path.isAbsolute(name) && !name.split("/").includes(".."), "Unsafe runtime inventory path");
    const raw = await fs.readFile(path.join(runtime, name)); need(hash(raw) === expected, "Runtime file drift: " + name); files[name] = expected;
  }
  const baselinePath=path.join(ROOT,"viewer/vendor/DEPENDENCIES.json");
  const baselineRaw=await fs.readFile(baselinePath),baseline=JSON.parse(baselineRaw);
  for(const [name, expected] of Object.entries(baseline.files)) {
    need(name.startsWith("viewer/vendor/")&&!name.split("/").includes(".."),"Unsafe dependency inventory path");
    const raw=await fs.readFile(path.join(ROOT,name));
    need(raw.length===expected.bytes&&hash(raw)===expected.sha256,"Rules/engine dependency drift: "+name);
  }
  const engineJs = path.join(ROOT, "viewer/vendor/stockfish/stockfish-19-lite-single.js");
  const wasm = path.join(ROOT, "viewer/vendor/stockfish/stockfish-19-lite-single.wasm");
  const engine = new UciProcess(engineJs);
  const checks = [];
  let report;
  try {
    await engine.command("uci", (s) => s === "uciok"); await engine.ready();
    const name = engine.lines.find((s) => s.startsWith("id name "))?.slice(8) || "unknown";
    for (const [depth, expected] of [[1, 20], [2, 400]]) {
      const actual = await engine.perft(depth); need(actual === expected, `Initial perft(${depth}) differs`);
      checks.push({ id: `initial-perft-${depth}`, expected, observed: actual, status: "pass" });
    }
    const mateFen = "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1";
    const mate = await engine.search(mateFen, 8), board = new Chess(mateFen);
    const move = board.move(uciMove(mate.uci)); need(move && board.isCheckmate(), "Stockfish mate-in-one move does not mate under chess.js");
    need(mate.score?.kind === "mate" && mate.score.value === 1, "Mate score is not mate-in-one for side to move");
    checks.push({ id: "known-mate-in-one", ...mate, san: move.san, independent_chessjs_checkmate: true, status: "pass" });
    const terminalFen = "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1";
    need(new Chess(terminalFen).isCheckmate(), "Terminal fixture is not checkmate");
    const terminal = await engine.search(terminalFen, 2);
    need(["(none)", "0000"].includes(terminal.uci), "Terminal engine result unexpectedly contains a move");
    checks.push({ id: "terminal-no-move", ...terminal, status: "pass" });
    const game = new Chess(), trace = [];
    for (let ply = 0; ply < 12 && !game.isGameOver(); ply++) {
      const result = await engine.search(game.fen(), 4), played = game.move(uciMove(result.uci));
      need(played, "Real engine produced an illegal move"); trace.push({ ply: ply + 1, input_fen: result.fen, uci: result.uci, san: played.san, output_fen: game.fen() });
    }
    need(trace.length === 12, "Bounded engine trace ended before twelve legal plies");
    checks.push({ id: "real-engine-legal-trace", plies: trace.length, trace, status: "pass",
      scope: "Twelve isolated FEN searches with legal move application; repetition/history transport is checked separately." });
    report = { schema: "x3dchess.runtime-check/1", status: "pass", started_utc: started, finished_utc: new Date().toISOString(),
      node: process.version, tool_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
      xite: { version: manifest.version, checked_files: Object.keys(files).length, origin_sha256: hash(await fs.readFile(path.join(runtime, "ORIGIN.json"))) },
      engine: { id: name, js_sha256: hash(await fs.readFile(engineJs)), wasm_sha256: hash(await fs.readFile(wasm)), execution: "vendored WebAssembly engine launched by Node UCI stdio" },
      chessjs_sha256: hash(await fs.readFile(path.join(ROOT, "viewer/vendor/chess.js"))), checks,
      dependency_manifest_sha256:hash(baselineRaw),
      scope: "Actual WASM engine UCI/rules controls plus runtime-file identity. Does not execute browser workers, native X_ITE rendering, GPU timing, or claim game strength." };
  } finally { engine.close(); }
  const output = path.join(ROOT, "evidence/runtime-check.json"); await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, engine: report.engine.id, checks: checks.length, output }));
}
main().catch(async (e) => {
  const report = { schema: "x3dchess.runtime-check/1", status: "fail", finished_utc: new Date().toISOString(),
    tool_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))), error: String(e.stack || e),
    scope: "Runtime check did not complete; this replaces any previous successful receipt." };
  await fs.mkdir(path.join(ROOT, "evidence"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "evidence/runtime-check.json"), JSON.stringify(report, null, 2) + "\n");
  console.error(e.stack || e); process.exitCode = 1;
});
