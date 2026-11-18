// Seeded random-legal playouts: an explicit engine-free demonstration, not recorded Stockfish games.
import { Chess } from "../vendor/chess.js";
import { Chess960, chess960StartFen, randomChess960Id } from "./chess960.js";
import { Transport, integerOption, terminalResult } from "./transport.js";
import { mulberry32 } from "./rng.js";
import { GameAnalysis } from "./analysis.js";
const VAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 }, PLY_CAP = 140;
export function materialCp(chess) {
  let score = 0;
  for (const row of chess.board()) for (const piece of row) if (piece) score += (piece.color === "w" ? 1 : -1) * VAL[piece.type];
  return score;
}
export class ReplayTransport extends Transport {
  async start({ boards = 20, seed = 1, intervalMs = 700, variant = "standard", position } = {}) {
    this.variant = variant; this.position = position;
    integerOption(boards, 1, 64, "Board count"); integerOption(intervalMs, 16, 60000, "Replay interval");
    if (!Number.isSafeInteger(seed)) throw new TypeError("Seed must be a safe integer");
    const request = ++this.startRequest; await this.stop({ silent: true, fromStart: true });
    if (request !== this.startRequest) return;
    const run = this.begin("replay");
    this.games = Array.from({ length: boards }, (_, i) => ({ id: `g${i}`, chess: new Chess(),
      rng: mulberry32(seed * 1000 + i), ply: 0, generation: 1, seq: 0, an: new GameAnalysis() }));
    for (const game of this.games) { if (variant === "960") this._newBoard960(game); }
    for (const game of this.games) { if (!this.active(run)) return; this._emitSnapshotFor(game); }
    this.status("running", "REPLAY: seeded random legal moves; evaluation is a material proxy");
    this.tasks = this.games.map(async (game, i) => {
      if (!await this.delay(intervalMs + (i * 37) % intervalMs, run)) return;
      while (this.active(run)) {
        this._step(game);
        if (!await this.delay(intervalMs, run)) return;
      }
    }).map((task) => task.catch((error) => { if (this.active(run)) { this.halt(); this.status("error", error.message); } }));
  }
  async stop({ silent = false, fromStart = false } = {}) { if (!fromStart) this.startRequest++; this.halt(); await Promise.all(this.tasks || []); this.tasks = []; if (!silent) this.status("stopped", "Replay stopped"); }
  _newBoard960(game) { game.positionId = this.position ?? randomChess960Id(game.rng); game.chess = new Chess960(chess960StartFen(game.positionId)); }
  _emitSnapshotFor(game) {
    this.gameEvent(game, { type: "snapshot_game", game_id: game.id, state: "playing", fen: game.chess.fen(), ply: game.ply,
      eval_cp: materialCp(game.chess), eval_fen: game.chess.fen(), eval_ply: game.ply, evaluation_kind: "material_proxy",
      ...(this.variant === "960" ? { opening: `Chess960 · #${game.positionId}`, variant: "chess960", position_id: game.positionId, fen960: game.chess.fen960(), start_fen: game.chess.fen() } : {}) });
  }
  _step(game) {
    const chess = game.chess, ending = terminalResult(chess, game.ply, PLY_CAP, "replay_cap");
    if (ending) {
      this.gameEvent(game, { type: "game_complete", game_id: game.id, ...ending });
      if (this.variant === "960") this._newBoard960(game); else chess.reset();
      game.ply = 0; game.generation++; game.seq = 0; game.an.reset(); this._emitSnapshotFor(game); return;
    }
    const moves = this.variant === "960" ? chess.legalMoves960() : chess.moves({ verbose: true });
    const weights = moves.map((m) => 1 + (m.captured || m.san.includes("x") ? 4 : 0) + (m.promotion ? 5 : 0) + (m.san.includes("+") ? 3 : 0) + (m.castle ? 3 : 0));
    let r = game.rng() * weights.reduce((a, b) => a + b, 0), pick = moves[0];
    for (let i = 0; i < moves.length; i++) { r -= weights[i]; if (r <= 0) { pick = moves[i]; break; } }
    const played = chess.move(this.variant === "960" ? { from: pick.from, to: pick.to, promotion: pick.promotion || undefined } : pick); game.ply++;
    const cp = materialCp(chess), analysis = game.an.onMove(chess, game.ply, cp, { evalFen: chess.fen(), evalPly: game.ply });
    this.gameEvent(game, { type: "move", game_id: game.id, state: "playing", ply: game.ply, san: pick.san,
      uci: played.displayUci || pick.from + pick.to + (pick.promotion || ""), fen: chess.fen(), eval_cp: cp, mate_in: null,
      eval_fen: chess.fen(), eval_ply: game.ply, evaluation_kind: "material_proxy",
      tactics: analysis.tactics, critical: analysis.critical, critical_for_ply: analysis.critical_for_ply ?? (analysis.critical ? game.ply : null),
      flags: played.flags, castle: played.castle || null, captured: played.captured || null });
    if (this.running && analysis.phase) this.gameEvent(game, { type: "phase_space_update", game_id: game.id, ...analysis.phase });
  }
}
