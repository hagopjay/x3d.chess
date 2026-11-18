"""Server tests. Engine tests use ENGINE_CMD, else the vendored Stockfish WASM under node; skipped if neither exists."""
import asyncio
import os
import shlex
import shutil
from pathlib import Path

import chess
import pytest

from x3dchess_server.analysis.phase_space import PhaseSpaceAnalyzer
from x3dchess_server.analysis.tactical_detector import TacticalDetector
from x3dchess_server.games import GameManager
from x3dchess_server.openings import OPENING_BOOK
from x3dchess_server.pool import EnginePool

VENDORED = Path(__file__).resolve().parents[2] / "viewer/vendor/stockfish/stockfish-19-lite-single.js"


def engine_cmd():
    if os.environ.get("ENGINE_CMD"):
        return shlex.split(os.environ["ENGINE_CMD"])
    if shutil.which("node") and VENDORED.exists():
        return ["node", str(VENDORED)]
    return None


needs_engine = pytest.mark.skipif(engine_cmd() is None, reason="no UCI engine available")


def test_openings_all_valid_fens():
    assert len(OPENING_BOOK) == 10
    for o in OPENING_BOOK.values():
        chess.Board(o.fen)


def test_phase_space_start_is_balanced():
    p = PhaseSpaceAnalyzer().analyze_position("g0", chess.STARTING_FEN, 0)
    assert p.material_balance == 0


def test_tactics_detects_knight_fork():
    # side to move (white) has Ne7 hitting Qc8 and Kg8; the ported detector only scans the side to move
    b = chess.Board("2q3k1/4N3/8/8/8/8/8/6K1 w - - 0 1")
    kinds = {m.pattern.value for m in TacticalDetector().detect_all_patterns(b)}
    assert "fork" in kinds


@needs_engine
def test_pool_finds_mate_in_one():
    async def run():
        pool = EnginePool(engine_cmd(), size=1)
        await pool.start()
        try:
            b = chess.Board("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")       # Ra8#
            r = await pool.search(b, depth=6)
            assert r["uci"] == "a1a8" and r["mate"] == 1
        finally:
            await pool.close()
    asyncio.run(run())


@needs_engine
def test_manager_serves_many_boards_on_few_engines():
    async def run():
        pool = EnginePool(engine_cmd(), size=2)
        await pool.start()
        gm = GameManager(pool, boards=8, depth=6)
        q = gm.register()
        await gm.start()
        try:
            moves, deadline = {}, asyncio.get_event_loop().time() + 25
            while len(moves) < 8 and asyncio.get_event_loop().time() < deadline:
                ev = await asyncio.wait_for(q.get(), 10)
                if ev["type"] == "move":
                    moves[ev["game_id"]] = ev
            assert len(moves) == 8                         # every board moved with 8 boards on 2 engines
            assert all(chess.Board(m["fen"]).is_valid() for m in moves.values())
        finally:
            await gm.stop(); await pool.close()
    asyncio.run(run())
