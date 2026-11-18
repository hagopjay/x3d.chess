// Real Stockfish WASM games. Failures are surfaced; never replaced by random replay.
import { Chess } from "../vendor/chess.js";
import { Transport, integerOption, terminalResult } from "./transport.js";
import { WasmEnginePool } from "./engine-pool.js";
import { mulberry32 } from "./rng.js";
import { pickOpening } from "./openings.js";
import { GameAnalysis } from "./analysis.js";
import { Chess960, chess960StartFen, randomChess960Id } from "./chess960.js";
const PLY_CAP = 200, MATE_CP = 1500;
export class WasmTransport extends Transport {
  constructor(onEvent, { poolFactory = (config) => new WasmEnginePool(config) } = {}) { super(onEvent); this.poolFactory = poolFactory; }
  halt() {
    super.halt();
    // A held loop is waiting outside the engine pool and the timer registry.
    // Wake it on every cancellation path; active(run) then prevents its move.
    for (const game of this.games || []) {
      if (!game.hold) continue;
      const { release } = game.hold; game.hold = null; release();
    }
  }
  async start({ boards = 20, seed = 1, depth = 12, poolSize, variant = "standard", position } = {}) {
    if (variant !== "standard" && variant !== "960") throw new RangeError("Variant must be standard or 960");
    if (position !== undefined) integerOption(position, 0, 959, "Chess960 position");
    integerOption(boards, 1, 64, "Board count"); integerOption(depth, 1, 30, "Depth");
    if (!Number.isSafeInteger(seed)) throw new TypeError("Seed must be a safe integer");
    if (poolSize !== undefined) integerOption(poolSize, 1, 8, "Pool size");
    const request = ++this.startRequest;
    await this.stop({ silent: true, fromStart: true });
    if (request !== this.startRequest) return;
    const run = this.begin("wasm"), pool = this.poolFactory(poolSize ? { size: poolSize } : {}); this.pool = pool;
    try {
      await pool.init();
      if (!this.active(run)) return;
      this.cfg = { depth, variant, position, chess960: variant === "960" }; this.cache = { hits: 0, misses: 0 };
      this.games = Array.from({ length: boards }, (_, i) => {
        const rng = mulberry32(seed * 1000 + i), skill = 14 + (i % 7);
        return { id: `g${i}`, rng, skill, speedMs: 80 + (skill - 14) * 20, generation: 0, seq: 0, an: new GameAnalysis() };
      });
      for (const game of this.games) { if (!this.active(run)) return; this._newGame(game); }
      this.status("running", "Stockfish WASM workers are ready", { workers: pool.size });
      this.tasks = this.games.map((game) => this._loop(game, run).catch((error) => {
        if (this.active(run)) { this.halt(); pool.terminate(); this.status("error", error.message); }
      }));
    } catch (error) {
      pool.terminate();
      if (this.active(run)) { this.halt(); this.status("error", error.message); throw error; }
    }
  }
  async stop({ silent = false, fromStart = false } = {}) {
    if (!fromStart) this.startRequest++;
    this.halt(); this.pool?.terminate();
    await Promise.all(this.tasks || []); this.tasks = [];
    if (!silent) this.status("stopped", "Stockfish workers stopped");
  }
  /** Bounded MultiPV analysis through the running pool; see WasmEnginePool.analyze. Does not touch game state. */
  analyze(fen, options) {
    if (!this.pool || this.pool.state !== "running") return Promise.reject(new Error("Engine pool is not running"));
    if (!this.cfg?.chess960) return this.pool.analyze(fen, options);
    // Chess960: the overlays speak chess.js FENs (castling "-"); the engine needs the Shredder-FEN with real rights.
    const game = this.games.find((g) => g.chess.fen() === fen), engineFen = game ? game.chess.fen960() : fen;
    return this.pool.analyze(engineFen, { ...options, chess960: true });   // normalizeResult binds it to the chess.js FEN and keeps engineFen for PV checks
  }
  /** Pause one game before its next move is applied, so a board can be analyzed in a stable position. Returns the held FEN. */
  holdGame(id) {
    const game = this.games?.find((g) => g.id === id);
    if (!game) throw new RangeError("Unknown game");
    if (!game.hold) { let release; game.hold = { promise: new Promise((r) => { release = r; }), release }; }
    return game.chess.fen();
  }
  releaseGame(id) {
    const game = this.games?.find((g) => g.id === id);
    if (game?.hold) { const { release } = game.hold; game.hold = null; release(); }
  }
  _newGame960(game) {
    const id = this.cfg.position ?? randomChess960Id(game.rng), fen = chess960StartFen(id);
    game.chess = new Chess960(fen); game.moves = []; game.positionId = id; game.initialFen = game.chess.fen960();
    game.opening = { name: `Chess960 · #${id}`, fen: game.chess.fen() };
  }
  _newGame(game) {
    if (this.cfg.chess960) this._newGame960(game); else this._newGame_standard(game);
    this._announce(game);
  }
  _newGame_standard(game) {
    game.opening = pickOpening(game.rng); game.initialFen = new Chess().fen();
    game.chess = new Chess(); game.moves = [];
    if (game.opening.moves) {
      for (const san of game.opening.moves) { const move = game.chess.move(san); game.moves.push(move.from + move.to + (move.promotion || "")); }
      if (game.chess.fen() !== game.opening.fen) throw new Error("Opening move history disagrees with its published FEN");
    } else { game.initialFen = game.opening.fen; game.chess = new Chess(game.initialFen); }
  }
  _announce(game) {
    game.ply = 0; game.generation++; game.seq = 0; game.an.reset();
    this.gameEvent(game, { type: "snapshot_game", game_id: game.id, state: "playing", fen: game.chess.fen(), ply: 0,
      eval_cp: null, eval_fen: null, eval_ply: null, evaluation_kind: "unavailable", opening: game.opening.name, skill: game.skill,
      start_fen: game.opening.fen, history: [], ...(this.cfg.chess960 ? { variant: "chess960", position_id: game.positionId, fen960: game.chess.fen960() } : {}) });
  }
  async _loop(game, run) {
    while (this.active(run)) {
      const chess = game.chess, ending = terminalResult(chess, game.ply, PLY_CAP, "ply_cap");
      if (ending) {
        this.gameEvent(game, { type: "game_complete", game_id: game.id, ...ending });
        if (!await this.delay(2500, run)) return;
        this._newGame(game); continue;
      }
      const before = chess.fen(), beforePly = game.ply, searchFen = this.cfg.chess960 ? chess.fen960() : before;
      const score = await this.pool.search(searchFen, { depth: this.cfg.depth, skill: game.skill,
        initialFen: game.initialFen, moves: game.moves, gameKey: `${game.id}:${game.generation}`, chess960: this.cfg.chess960 });
      if (!this.active(run)) return;
      while (game.hold) { await game.hold.promise; if (!this.active(run)) return; }   // paused for analysis: the searched move is applied only after release
      if (game.chess !== chess || chess.fen() !== before) throw new Error("Board changed during its Stockfish search");
      if (!score.uci) throw new Error("Stockfish returned no move for a non-terminal position");
      const move = chess.move({ from: score.uci.slice(0, 2), to: score.uci.slice(2, 4), promotion: score.uci[4] });
      if (!move) throw new Error("Stockfish returned an illegal move");
      game.moves.push(score.uci); game.ply++;
      const shownUci = move.displayUci || score.uci;   // castling is king-takes-rook for the engine, king-to-destination on the board
      const cp = score.mate != null ? Math.sign(score.mate) * MATE_CP : score.cp;
      const analysis = game.an.onMove(chess, game.ply, cp, { evalFen: before, evalPly: beforePly, mateIn: score.mate, scoreBound: score.score_bound });
      this.gameEvent(game, { type: "move", game_id: game.id, state: "playing", ply: game.ply,
        san: move.san, uci: shownUci, engine_uci: score.uci, fen: chess.fen(), ...(this.cfg.chess960 ? { fen960: chess.fen960() } : {}), eval_cp: cp, mate_in: score.mate,
        eval_fen: before, eval_ply: beforePly, evaluation_kind: score.mate != null ? "engine_mate" : cp != null ? "engine_cp" : "unavailable",
        score_bound: score.score_bound ?? null, depth: score.depth, nodes: score.nodes,
        tactics: analysis.tactics, critical: analysis.critical, critical_for_ply: analysis.critical_for_ply ?? (analysis.critical ? beforePly : null),
        flags: move.flags, castle: move.castle || null, captured: move.captured || null });
      if (this.active(run) && analysis.phase) this.gameEvent(game, { type: "phase_space_update", game_id: game.id, ...analysis.phase });
      if (!await this.delay(game.speedMs, run)) return;
    }
  }
}
