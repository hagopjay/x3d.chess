"""GameManager: N concurrent games over a shared EnginePool, with the ported analysis modules.

Event names and fields match docs/PROTOCOL.md and the browser WasmTransport.
"""
from __future__ import annotations
import asyncio
import json
import logging
import random
import chess

from .analysis.bifurcation_detector import BifurcationDetector
from .analysis.convergence_tracker import ConvergenceTracker
from .analysis.phase_space import PhaseSpaceAnalyzer
from .analysis.tactical_detector import TacticalDetector
from .openings import OPENING_BOOK
from .pool import EnginePool, bounded_int

log = logging.getLogger("x3dchess")
PLY_CAP = 200
MATE_CP = 1500


def view_fen(board: chess.Board) -> str:
    """FEN the browser overlays can read with chess.js: castling field "-" for Chess960 boards (chess.js has no 960
    castling and rejects Shredder letters). The full rights travel in `fen960`; standard boards are unchanged."""
    if not board.chess960:
        return board.fen()
    f = board.fen().split(" ")
    f[2] = "-"
    return " ".join(f)


def display_uci(board: chess.Board, move: chess.Move) -> str:
    """Board highlight squares: castling is shown king -> destination, even though the engine speaks king-takes-rook."""
    if board.chess960 and board.is_castling(move):
        rank = chess.square_rank(move.from_square)
        dest = chess.square(6 if board.is_kingside_castling(move) else 2, rank)
        return chess.Move(move.from_square, dest).uci()
    return move.uci()


class Game:
    def __init__(self, gid: str, skill: int, rng: random.Random, variant: str = "standard", position: int | None = None):
        self.id, self.skill, self.rng = gid, skill, rng
        self.variant, self.fixed_position, self.position_id = variant, position, None
        self.speed_s = 0.08 + (skill - 14) * 0.02       # same formula as the original game_manager
        self.board = chess.Board()
        self.ply = 0
        self.opening = ""
        self.eval_cp = 0
        self.bifurcation = BifurcationDetector()
        self.generation = 0
        self.new_game()

    def new_game(self) -> None:
        if self.variant == "960":
            self.position_id = self.fixed_position if self.fixed_position is not None else self.rng.randrange(960)
            self.opening, self.board, self.ply = f"Chess960 · #{self.position_id}", chess.Board.from_chess960_pos(self.position_id), 0
        else:
            ops = list(OPENING_BOOK.values())
            op = self.rng.choices(ops, weights=[o.weight for o in ops], k=1)[0]
            self.opening, self.board, self.ply = op.name, op.board(), 0
        self.start_fen = view_fen(self.board)
        self.eval_cp = self.eval_fen = self.eval_ply = self.mate_in = None
        self.score_bound = None
        self.state, self.result, self.reason, self.adjudicated = "playing", None, None, False
        self.history = []
        self.generation += 1
        self.bifurcation = BifurcationDetector()


class GameManager:
    def __init__(self, pool: EnginePool, boards: int = 20, depth: int = 12, seed: int = 1,
                 client_queue_size: int = 2000, variant: str = "standard", position: int | None = None):
        bounded_int(boards, 1, 64, "boards")
        if variant not in ("standard", "960"):
            raise ValueError("variant must be standard or 960")
        if position is not None:
            bounded_int(position, 0, 959, "position")
            if variant != "960":
                raise ValueError("position needs variant 960")
        self.variant = variant
        self.pool, self.depth = pool, bounded_int(depth, 1, 30, "depth")
        bounded_int(client_queue_size, boards, 10000, "client_queue_size")
        self.client_queue_size = client_queue_size
        self.games = [Game(f"g{i}", 14 + (i % 7), random.Random(seed * 1000 + i), variant, position) for i in range(boards)]
        self.clients: set[asyncio.Queue] = set()
        self.tactics = TacticalDetector()
        self.phase = PhaseSpaceAnalyzer()
        self.convergence = ConvergenceTracker()
        self.total_moves = 0
        self.tasks: list[asyncio.Task] = []
        self.sequence = 0

    # ---- fan-out -------------------------------------------------------
    def emit(self, ev: dict) -> None:
        self.sequence += 1
        ev = {**ev, "seq": self.sequence}
        if "game_id" in ev:
            game = next((g for g in self.games if g.id == ev["game_id"]), None)
            if game is not None:
                ev.setdefault("generation", game.generation)
        for q in list(self.clients):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                self.clients.discard(q)
                # Actually close the SSE stream. Merely forgetting its queue
                # leaves a heartbeat-only client that never reconnects.
                while not q.empty():
                    q.get_nowait()
                q.put_nowait(None)

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self.client_queue_size)
        for g in self.games:
            q.put_nowait(self._snapshot_event(g))
        self.clients.add(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def _snapshot_event(self, g: Game) -> dict:
        return {"type": "snapshot_game", "game_id": g.id, "fen": view_fen(g.board), "ply": g.ply,
                **({"variant": "chess960", "position_id": g.position_id, "fen960": g.board.shredder_fen()} if g.variant == "960" else {}),
                "eval_cp": g.eval_cp, "eval_fen": g.eval_fen, "eval_ply": g.eval_ply,
                "eval_source": "uci_search" if g.eval_fen else "unknown", "mate_in": g.mate_in,
                "evaluation_kind": "engine_mate" if g.mate_in is not None else "engine_cp" if g.eval_cp is not None else "unavailable",
                "score_bound": g.score_bound,
                "opening": g.opening, "skill": g.skill, "start_fen": g.start_fen,
                "history": list(g.history), "generation": g.generation, "seq": self.sequence,
                "state": g.state, "result": g.result, "reason": g.reason,
                "adjudicated": g.adjudicated}

    def stats(self) -> dict:
        p = self.pool
        return {"boards": len(self.games), "engines": p.size, "searches": p.searches, "nodes": p.nodes,
                "engine_busy_s": round(p.busy_s, 2), "moves": self.total_moves, "clients": len(self.clients),
                "depth": self.depth, "engines_alive": p.alive, "engine_failures": p.failures,
                "engine_launches": p.launches, "draw_policy": "claim_available", "variant": self.variant,
                "ply_cap": PLY_CAP, "running": bool(self.tasks)}

    # ---- loop ----------------------------------------------------------
    async def start(self) -> None:
        if self.tasks:
            raise RuntimeError("game manager already running")
        for g in self.games:
            self.convergence.add_game(g.id)
            self.tasks.append(asyncio.create_task(self._loop(g)))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
        for q in list(self.clients):
            while not q.empty(): q.get_nowait()
            q.put_nowait(None)
        self.clients.clear()

    def _complete_if_ready(self, g: Game) -> bool:
        outcome = g.board.outcome(claim_draw=True)
        if outcome is None and g.ply < PLY_CAP:
            return False
        reasons = {chess.Termination.CHECKMATE: "checkmate", chess.Termination.STALEMATE: "stalemate",
                   chess.Termination.INSUFFICIENT_MATERIAL: "insufficient_material",
                   chess.Termination.SEVENTYFIVE_MOVES: "seventyfive_move",
                   chess.Termination.FIVEFOLD_REPETITION: "fivefold",
                   chess.Termination.FIFTY_MOVES: "fifty_move",
                   chess.Termination.THREEFOLD_REPETITION: "threefold"}
        g.result = outcome.result() if outcome else "1/2-1/2"
        g.reason = reasons[outcome.termination] if outcome else "ply_cap"
        g.adjudicated = outcome is None or outcome.termination in (
            chess.Termination.FIFTY_MOVES, chess.Termination.THREEFOLD_REPETITION)
        g.state = "complete"
        self.emit({"type": "game_complete", "game_id": g.id, "result": g.result,
                   "reason": g.reason, "adjudicated": g.adjudicated,
                   "draw_policy": "claim_available", "fen": view_fen(g.board), "ply": g.ply, "state": "complete"})
        return True

    async def _loop(self, g: Game) -> None:
        while True:
            b = g.board
            if g.state == "complete" or self._complete_if_ready(g):
                await asyncio.sleep(2.5)
                g.new_game()
                self.phase.reset_game(g.id)
                self.convergence.reset_game(g.id)
                self.convergence.add_game(g.id)
                self.emit(self._snapshot_event(g))
                continue
            try:
                source_fen, source_ply, generation = b.fen(), g.ply, g.generation
                s = await self.pool.search(b, self.depth, g.skill)
                if g.board is not b or g.generation != generation or b.fen() != source_fen:
                    continue
                if s.get("eval_fen", source_fen) != source_fen:
                    raise ValueError("engine score belongs to another position")
                mv = chess.Move.from_uci(s["uci"] or "")
                if mv not in b.legal_moves:
                    raise ValueError("engine returned an illegal move")
                san = b.san(mv)
                captured = (b.piece_at(mv.to_square) is not None and not b.is_castling(mv)) or b.is_en_passant(mv)
                shown = display_uci(b, mv)
            except Exception as e:                          # engine died: report, back off, keep the board alive
                log.warning("%s: search failed: %s", g.id, e)
                await asyncio.sleep(1)
                continue
            source_view = view_fen(b)
            s = {**s, "eval_fen": source_view, "eval_ply": source_ply}
            castled = b.is_castling(mv)
            castle_side = ('k' if b.is_kingside_castling(mv) else 'q') if castled else None
            b.push(mv)
            g.ply += 1
            g.history.append(san)
            self.total_moves += 1
            g.mate_in, g.eval_fen, g.eval_ply = s["mate"], source_view, source_ply
            g.score_bound = s.get("score_bound", "exact")
            g.eval_cp = ((s.get("mate_cp") if s.get("mate_cp") is not None else
                          (MATE_CP if s["mate"] > 0 else -MATE_CP)) if s["mate"] is not None
                         else s["cp"])
            tactics, critical = self._analyse(g, s, shown)
            self.emit({"type": "move", "game_id": g.id, "ply": g.ply, "san": san, "uci": shown, "fen": view_fen(b),
                       **({"engine_uci": s["uci"], "fen960": b.shredder_fen(), "castle": castle_side} if g.variant == "960" and castled else {}),
                       **({"fen960": b.shredder_fen()} if g.variant == "960" and not castled else {}),
                       "eval_cp": g.eval_cp, "mate_in": s["mate"], "depth": s["depth"], "nodes": s["nodes"],
                       "eval_fen": source_view, "eval_ply": source_ply, "eval_source": "uci_search",
                       "evaluation_kind": "engine_mate" if s["mate"] is not None else "engine_cp" if g.eval_cp is not None else "unavailable",
                       "score_bound": g.score_bound,
                       "tactics": tactics, "critical": critical,
                       "critical_for_ply": source_ply if critical else None, "captured": captured or None})
            if g.ply % 4 == 0:
                self.emit({"type": "phase_space_update", "game_id": g.id,
                           **self.phase.analyze_position(g.id, view_fen(b), g.ply).to_dict()})
            if self.total_moves % 20 == 0:
                self.emit({"type": "convergence_update", "summary": self.convergence.get_summary(),
                           "pairs": self.convergence.get_top_convergent_pairs(3), "outliers": self.convergence.get_outliers()})
            if not self._complete_if_ready(g):
                await asyncio.sleep(g.speed_s)

    def _analyse(self, g: Game, s: dict, uci: str):
        pawns = g.eval_cp / 100.0 if g.eval_cp is not None else None
        try:
            motifs = self.tactics.detect_all_patterns(g.board)
            tactics = [m.to_dict() for m in motifs][:3]
        except Exception as e:
            log.debug("tactics: %s", e); tactics = []
        critical = None
        try:
            if pawns is None or s["mate"] is not None or s.get("score_bound", "exact") != "exact":
                g.bifurcation = BifurcationDetector()
                return tactics, None
            g.bifurcation.add_position(s["eval_ply"], pawns, uci, s["eval_fen"])
            m = g.bifurcation.get_latest_critical_moment()
            if m and m.move_number == s["eval_ply"]:
                critical = m.severity
        except Exception as e:
            log.debug("bifurcation: %s", e)
        try:
            self.convergence.update_eval(g.id, pawns)
        except Exception as e:
            log.debug("convergence: %s", e)
        return tactics, critical
