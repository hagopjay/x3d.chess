"""Bounded, cancellation-safe leases over UCI engine processes.

A failed or cancelled search retires its process. Its slot is recreated lazily
by the next caller, so a dead engine cannot circulate indefinitely or reduce
the pool to an empty queue. The caller's position is copied before searching.
"""
from __future__ import annotations

import asyncio
import math
import time
import chess
import chess.engine


def bounded_int(value: int, lower: int, upper: int, name: str) -> int:
    if type(value) is not int or not lower <= value <= upper:
        raise ValueError(f"{name} must be an integer from {lower} to {upper}")
    return value


class EnginePool:
    def __init__(self, command: list[str], size: int = 2, hash_mb: int = 16,
                 search_timeout: float = 30.0, startup_timeout: float = 15.0):
        if not isinstance(command, (list, tuple)) or not command or not all(isinstance(s, str) and s for s in command):
            raise ValueError("command must be a nonempty argument list")
        self.command = list(command)
        self.size = bounded_int(size, 1, 16, "pool size")
        self.hash_mb = bounded_int(hash_mb, 1, 2048, "hash_mb")
        for value in (search_timeout, startup_timeout):
            if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                raise ValueError("engine timeouts must be positive and finite")
        self.search_timeout, self.startup_timeout = search_timeout, startup_timeout
        self._free: asyncio.Queue = asyncio.Queue(maxsize=self.size)
        self._transports: dict = {}
        self._tasks: set[asyncio.Task] = set()
        self._started = False
        self._closing = False
        self.searches = self.nodes = self.failures = self.launches = 0
        self.busy_s = 0.0

    @property
    def alive(self) -> int:
        return sum(not eng.returncode.done() for eng in self._transports)

    async def _retire(self, eng) -> None:
        transport = self._transports.pop(eng, None)
        if transport is not None:
            transport.close()
        future = getattr(eng, "returncode", None)
        if future is not None:
            try:
                await asyncio.wait_for(asyncio.shield(future), timeout=2)
            except Exception:
                pass

    async def _spawn(self):
        transport, eng = await asyncio.wait_for(chess.engine.popen_uci(self.command),
                                               timeout=self.startup_timeout)
        self._transports[eng] = transport
        try:
            opts = {k: v for k, v in {"Threads": 1, "Hash": self.hash_mb}.items() if k in eng.options}
            if opts:
                await asyncio.wait_for(eng.configure(opts), timeout=self.startup_timeout)
        except BaseException:
            await self._retire(eng)
            raise
        self.launches += 1
        return eng

    async def start(self) -> None:
        if self._started or self._closing:
            raise RuntimeError("pool already started or closed")
        try:
            for _ in range(self.size):
                self._free.put_nowait(await self._spawn())
        except BaseException:
            await self.close()
            raise
        self._started = True

    async def search(self, board: chess.Board, depth: int, skill: int = 20) -> dict:
        """White-positive score of the supplied PRE-move position.

        The result's eval_fen identifies that position. The move may produce a
        different post-move FEN; the score is not silently reassigned to it.
        """
        bounded_int(depth, 1, 30, "depth")
        bounded_int(skill, 0, 20, "skill")
        if not self._started or self._closing:
            raise RuntimeError("pool is not running")
        if not isinstance(board, chess.Board) or not board.is_valid():
            raise ValueError("search requires a valid chess or Chess960 position")
        position = board.copy(stack=True)
        task = asyncio.current_task()
        self._tasks.add(task)
        eng = None
        leased = healthy = False
        t0 = None
        try:
            eng = await self._free.get()
            leased = True
            t0 = time.perf_counter()
            if eng is None:
                eng = await self._spawn()
            if "Skill Level" in eng.options:
                await asyncio.wait_for(eng.configure({"Skill Level": skill}), timeout=self.startup_timeout)
            res = await asyncio.wait_for(
                eng.play(position, chess.engine.Limit(depth=depth),
                         info=chess.engine.INFO_SCORE | chess.engine.INFO_BASIC),
                timeout=self.search_timeout)
            if res.move is None and any(position.legal_moves):
                raise chess.engine.EngineError("engine returned no move in a playable position")
            if res.move is not None and res.move not in position.legal_moves:
                raise chess.engine.EngineError("engine returned an illegal move")
            info = res.info or {}
            score = info.get("score")
            w = score.white() if score is not None else None
            bound = ("unknown" if info.get("lowerbound") and info.get("upperbound") else
                     "lowerbound" if info.get("lowerbound") else
                     "upperbound" if info.get("upperbound") else "exact") if w is not None else None
            self.searches += 1
            nodes = max(0, int(info.get("nodes", 0)))
            self.nodes += nodes
            healthy = True
            return {"uci": position.uci(res.move) if res.move else None,
                    "cp": w.score() if w is not None and not w.is_mate() else None,
                    "mate": w.mate() if w is not None and w.is_mate() else None,
                    "mate_cp": (1500 if w > chess.engine.Cp(0) else -1500) if w is not None and w.is_mate() else None,
                    "score_bound": bound,
                    "depth": int(info.get("depth", 0)), "nodes": nodes,
                    "eval_fen": position.fen()}
        except Exception:
            self.failures += 1
            raise
        finally:
            self._tasks.discard(task)
            if t0 is not None:
                self.busy_s += time.perf_counter() - t0
            if eng is not None:
                if not healthy or eng.returncode.done():
                    await self._retire(eng)
                    eng = None
            if leased and not self._closing:
                self._free.put_nowait(eng)

    async def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        self._started = False
        current = asyncio.current_task()
        tasks = [t for t in self._tasks if t is not current]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for eng in list(self._transports):
            try:
                await asyncio.wait_for(eng.quit(), timeout=2)
            except Exception:
                pass
            finally:
                await self._retire(eng)
        while not self._free.empty():
            self._free.get_nowait()
