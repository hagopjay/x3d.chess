"""EnginePool: N boards served by M UCI engine processes (docs/ARCHITECTURE.md "Why a pool").

The original spawned one Stockfish per game (20 processes). Here a bounded set of engines is shared:
each board leases an engine for one search and returns it. Any UCI engine works, so the same pool drives
a native stockfish.exe on the owner's PC or `node stockfish-19-lite-single.js` where no binary is installed.
"""
from __future__ import annotations
import asyncio
import time
import chess
import chess.engine


class EnginePool:
    def __init__(self, command: list[str], size: int = 2, hash_mb: int = 16):
        self.command, self.size, self.hash_mb = command, size, hash_mb
        self._free: asyncio.Queue = asyncio.Queue()
        self._engines: list[chess.engine.UciProtocol] = []
        self.searches = 0
        self.nodes = 0
        self.busy_s = 0.0

    async def start(self) -> None:
        for _ in range(self.size):
            _, eng = await chess.engine.popen_uci(self.command)
            opts = {k: v for k, v in {"Threads": 1, "Hash": self.hash_mb}.items() if k in eng.options}
            if opts:
                await eng.configure(opts)
            self._engines.append(eng)
            self._free.put_nowait(eng)

    async def search(self, board: chess.Board, depth: int, skill: int = 20) -> dict:
        """White-positive score. Returns {uci, cp, mate, depth, nodes}."""
        eng = await self._free.get()
        t0 = time.perf_counter()
        try:
            if "Skill Level" in eng.options:
                await eng.configure({"Skill Level": skill})
            res = await eng.play(board, chess.engine.Limit(depth=depth), info=chess.engine.INFO_SCORE | chess.engine.INFO_BASIC)
            info = res.info or {}
            score = info.get("score")
            w = score.white() if score is not None else None
            self.searches += 1
            self.nodes += int(info.get("nodes", 0))
            return {
                "uci": res.move.uci() if res.move else None,
                "cp": w.score() if w is not None and not w.is_mate() else None,
                "mate": w.mate() if w is not None and w.is_mate() else None,
                "depth": int(info.get("depth", 0)),
                "nodes": int(info.get("nodes", 0)),
            }
        finally:
            self.busy_s += time.perf_counter() - t0
            self._free.put_nowait(eng)

    async def close(self) -> None:
        for e in self._engines:
            try:
                await e.quit()
            except Exception:
                pass
