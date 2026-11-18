"""EnginePool: N boards served by M Stockfish processes (scaffold; implemented in phase 2).

Design (docs/ARCHITECTURE.md): the original spawned one Stockfish per game (20 processes).
Here a bounded pool of engines (default = CPU cores) is shared; each board is a coroutine
that leases an engine per move, so 20+ boards run on a small PC. UCI is driven through
python-chess `chess.engine.SimpleEngine`/`popen_uci`; one `go depth D` per move, hash and
threads set per engine, `ucinewgame` between games.
"""
from __future__ import annotations
import asyncio

class EnginePool:
    def __init__(self, stockfish_path: str, size: int):
        self.path, self.size = stockfish_path, size
        self._sem = asyncio.Semaphore(size)

    async def best_move(self, fen: str, depth: int):
        raise NotImplementedError("phase 2")
