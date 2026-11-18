// ReplayTransport: engine-free source of the exact same events the real transports emit (docs/PROTOCOL.md).
// Games are seeded random-legal playouts biased towards captures/checks/promotions so they look alive.
// eval_cp here is a MATERIAL PROXY (P=100 N=B=300 R=500 Q=900), NOT an engine score; phase 2 replaces it.
import { Chess } from "../vendor/chess.js";
import { Transport } from "./transport.js";
import { mulberry32 } from "./rng.js";
import { GameAnalysis } from "./analysis.js";

const VAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const PLY_CAP = 140;

export function materialCp(chess) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p) s += (p.color === "w" ? 1 : -1) * VAL[p.type];
  return s;
}

export class ReplayTransport extends Transport {
  /** config: {boards, seed, intervalMs} */
  async start(config = {}) {
    const { boards = 20, seed = 1, intervalMs = 700 } = config;
    this.games = Array.from({ length: boards }, (_, i) => ({
      id: `g${i}`, chess: new Chess(), rng: mulberry32(seed * 1000 + i), ply: 0, gen: 0, an: new GameAnalysis(),
    }));
    for (const g of this.games) this._emitSnapshotFor(g);
    this.timer = setInterval(() => this.games.forEach((g, i) => setTimeout(() => this._step(g), (i * 37) % intervalMs)), intervalMs);
  }
  async stop() { clearInterval(this.timer); }

  _emitSnapshotFor(g) {
    this.onEvent({ type: "snapshot_game", game_id: g.id, fen: g.chess.fen(), ply: g.ply, eval_cp: materialCp(g.chess) });
  }

  _step(g) {
    const c = g.chess;
    const over = c.isGameOver() || g.ply >= PLY_CAP;
    if (over) {
      const reason = c.isCheckmate() ? "checkmate" : c.isStalemate() ? "stalemate" : c.isThreefoldRepetition() ? "threefold"
        : c.isInsufficientMaterial() ? "insufficient_material" : c.isDrawByFiftyMoves?.() ? "fifty_move" : "replay_cap";
      const result = c.isCheckmate() ? (c.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2";
      this.onEvent({ type: "game_complete", game_id: g.id, result, reason });
      c.reset(); g.ply = 0; g.gen++; g.an.reset();
      this._emitSnapshotFor(g);
      return;
    }
    const moves = c.moves({ verbose: true });
    const weights = moves.map((m) => 1 + (m.captured ? 4 : 0) + (m.promotion ? 5 : 0) + (m.san.includes("+") ? 3 : 0));
    let r = g.rng() * weights.reduce((a, b) => a + b, 0), pick = moves[0];
    for (let i = 0; i < moves.length; i++) { r -= weights[i]; if (r <= 0) { pick = moves[i]; break; } }
    c.move(pick);
    g.ply++;
    const cp = materialCp(c), an = g.an.onMove(c, g.ply, cp);
    this.onEvent({
      type: "move", game_id: g.id, ply: g.ply, san: pick.san, uci: pick.from + pick.to + (pick.promotion || ""),
      fen: c.fen(), eval_cp: cp, mate_in: null, tactics: an.tactics, critical: an.critical,
      flags: pick.flags, captured: pick.captured || null,
    });
    if (an.phase) this.onEvent({ type: "phase_space_update", game_id: g.id, ...an.phase });
  }
}
