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
from .pool import EnginePool

log = logging.getLogger("x3dchess")
PLY_CAP = 200
MATE_CP = 1500


class Game:
    def __init__(self, gid: str, skill: int, rng: random.Random):
        self.id, self.skill, self.rng = gid, skill, rng
        self.speed_s = 0.08 + (skill - 14) * 0.02       # same formula as the original game_manager
        self.board = chess.Board()
        self.ply = 0
        self.opening = ""
        self.eval_cp = 0
        self.bifurcation = BifurcationDetector()

    def new_game(self) -> None:
        ops = list(OPENING_BOOK.values())
        op = self.rng.choices(ops, weights=[o.weight for o in ops], k=1)[0]
        self.opening, self.board, self.ply, self.eval_cp = op.name, chess.Board(op.fen), 0, 0
        self.bifurcation = BifurcationDetector()


class GameManager:
    def __init__(self, pool: EnginePool, boards: int = 20, depth: int = 12, seed: int = 1):
        self.pool, self.depth = pool, depth
        self.games = [Game(f"g{i}", 14 + (i % 7), random.Random(seed * 1000 + i)) for i in range(boards)]
        self.clients: set[asyncio.Queue] = set()
        self.tactics = TacticalDetector()
        self.phase = PhaseSpaceAnalyzer()
        self.convergence = ConvergenceTracker()
        self.total_moves = 0
        self.tasks: list[asyncio.Task] = []

    # ---- fan-out -------------------------------------------------------
    def emit(self, ev: dict) -> None:
        for q in list(self.clients):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                self.clients.discard(q)            # slow client: drop it, it reconnects and gets a snapshot

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        for g in self.games:
            q.put_nowait(self._snapshot_event(g))
        self.clients.add(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def _snapshot_event(self, g: Game) -> dict:
        return {"type": "snapshot_game", "game_id": g.id, "fen": g.board.fen(), "ply": g.ply,
                "eval_cp": g.eval_cp, "opening": g.opening, "skill": g.skill}

    def stats(self) -> dict:
        p = self.pool
        return {"boards": len(self.games), "engines": p.size, "searches": p.searches, "nodes": p.nodes,
                "engine_busy_s": round(p.busy_s, 2), "moves": self.total_moves, "clients": len(self.clients),
                "depth": self.depth}

    # ---- loop ----------------------------------------------------------
    async def start(self) -> None:
        for g in self.games:
            g.new_game()
            self.convergence.add_game(g.id)
            self.tasks.append(asyncio.create_task(self._loop(g)))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def _loop(self, g: Game) -> None:
        while True:
            b = g.board
            if b.is_game_over(claim_draw=True) or g.ply >= PLY_CAP:
                reason = ("checkmate" if b.is_checkmate() else "stalemate" if b.is_stalemate()
                          else "insufficient_material" if b.is_insufficient_material()
                          else "threefold" if b.can_claim_threefold_repetition()
                          else "fifty_move" if b.can_claim_fifty_moves() else "ply_cap")
                result = ("0-1" if b.turn else "1-0") if b.is_checkmate() else "1/2-1/2"
                self.emit({"type": "game_complete", "game_id": g.id, "result": result, "reason": reason})
                await asyncio.sleep(2.5)
                g.new_game()
                self.phase.reset_game(g.id)
                self.convergence.reset_game(g.id)
                self.convergence.add_game(g.id)
                self.emit(self._snapshot_event(g))
                continue
            try:
                s = await self.pool.search(b, self.depth, g.skill)
            except Exception as e:                          # engine died: report, back off, keep the board alive
                log.warning("%s: search failed: %s", g.id, e)
                await asyncio.sleep(1)
                continue
            if not s["uci"]:
                g.ply = PLY_CAP
                continue
            mv = chess.Move.from_uci(s["uci"])
            san = b.san(mv)
            captured = b.piece_at(mv.to_square) is not None or b.is_en_passant(mv)
            b.push(mv)
            g.ply += 1
            self.total_moves += 1
            g.eval_cp = s["mate"] and (MATE_CP if s["mate"] > 0 else -MATE_CP) or (s["cp"] or 0)
            tactics, critical = self._analyse(g, s, s["uci"])
            self.emit({"type": "move", "game_id": g.id, "ply": g.ply, "san": san, "uci": s["uci"], "fen": b.fen(),
                       "eval_cp": g.eval_cp, "mate_in": s["mate"], "depth": s["depth"], "nodes": s["nodes"],
                       "tactics": tactics, "critical": critical, "captured": captured or None})
            if g.ply % 4 == 0:
                self.emit({"type": "phase_space_update", "game_id": g.id,
                           **self.phase.analyze_position(g.id, b.fen(), g.ply).to_dict()})
            if self.total_moves % 20 == 0:
                self.emit({"type": "convergence_update", "summary": self.convergence.get_summary(),
                           "pairs": self.convergence.get_top_convergent_pairs(3), "outliers": self.convergence.get_outliers()})
            await asyncio.sleep(g.speed_s)

    def _analyse(self, g: Game, s: dict, uci: str):
        pawns = g.eval_cp / 100.0
        try:
            motifs = self.tactics.detect_all_patterns(g.board)
            tactics = [m.to_dict() for m in motifs if m.severity in ("winning", "material")][:3]
        except Exception as e:
            log.debug("tactics: %s", e); tactics = []
        critical = None
        try:
            g.bifurcation.add_position(g.ply, pawns, uci, g.board.fen())
            m = g.bifurcation.get_latest_critical_moment()
            if m and m.move_number == g.ply:
                critical = m.severity
        except Exception as e:
            log.debug("bifurcation: %s", e)
        try:
            self.convergence.update_eval(g.id, pawns)
        except Exception as e:
            log.debug("convergence: %s", e)
        return tactics, critical
