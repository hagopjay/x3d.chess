// WasmTransport: N games driven by a shared WasmEnginePool. Emits the same events as the Python server.
// Game config ported from chess-spectator game_manager.py: opening per board (weighted), skill 14-20 cycling,
// speed rising with skill. Search depth is a browser default (12) rather than the original 14-20 (see docs/PORT-MAP.md).
import { Chess } from "../vendor/chess.js";
import { Transport } from "./transport.js";
import { WasmEnginePool } from "./engine-pool.js";
import { mulberry32 } from "./rng.js";
import { pickOpening } from "./openings.js";

const PLY_CAP = 200;
const MATE_CP = 1500;

export class WasmTransport extends Transport {
  /** config: {boards, seed, depth, poolSize} */
  async start({ boards = 20, seed = 1, depth = 12, poolSize } = {}) {
    this.pool = new WasmEnginePool(poolSize ? { size: poolSize } : {});
    await this.pool.init();
    this.running = true;
    this.cfg = { depth };
    this.cache = { hits: 0, misses: 0 };
    this.games = Array.from({ length: boards }, (_, i) => {
      const rng = mulberry32(seed * 1000 + i), skill = 14 + (i % 7);
      return { id: `g${i}`, rng, skill, speedMs: 80 + (skill - 14) * 20, chess: new Chess(), ply: 0, opening: null };
    });
    this.games.forEach((g) => this._newGame(g));
    this.games.forEach((g) => this._loop(g));
  }

  async stop() { this.running = false; this.pool?.terminate(); }

  _newGame(g) {
    g.opening = pickOpening(g.rng);
    g.chess = new Chess(g.opening.fen);
    g.ply = 0;
    this.onEvent({ type: "snapshot_game", game_id: g.id, fen: g.chess.fen(), ply: 0, eval_cp: 0, opening: g.opening.name, skill: g.skill });
  }

  async _loop(g) {
    while (this.running) {
      const c = g.chess;
      if (c.isGameOver() || g.ply >= PLY_CAP) {
        const reason = c.isCheckmate() ? "checkmate" : c.isStalemate() ? "stalemate" : c.isThreefoldRepetition() ? "threefold"
          : c.isInsufficientMaterial() ? "insufficient_material" : c.isDraw() ? "fifty_move" : "ply_cap";
        const result = c.isCheckmate() ? (c.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2";
        this.onEvent({ type: "game_complete", game_id: g.id, result, reason });
        await new Promise((r) => setTimeout(r, 2500));          // let the viewer show the final position
        if (!this.running) return;
        this._newGame(g);
        continue;
      }
      let s;
      try { s = await this.pool.search(c.fen(), { depth: this.cfg.depth, skill: g.skill }); }
      catch (e) { if (!this.running) return; throw e; }
      if (!this.running) return;
      if (!s.uci) { g.ply = PLY_CAP; continue; }
      const mv = c.move({ from: s.uci.slice(0, 2), to: s.uci.slice(2, 4), promotion: s.uci[4] });
      g.ply++;
      const eval_cp = s.mate != null ? Math.sign(s.mate) * MATE_CP : s.cp ?? 0;
      this.onEvent({
        type: "move", game_id: g.id, ply: g.ply, san: mv.san, uci: s.uci, fen: c.fen(),
        eval_cp, mate_in: s.mate, depth: s.depth, nodes: s.nodes, tactics: [], critical: null,
        flags: mv.flags, captured: mv.captured || null,
      });
      await new Promise((r) => setTimeout(r, g.speedMs));
    }
  }
}
