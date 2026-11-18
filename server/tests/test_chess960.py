"""Chess960 over the real engine: UCI_Chess960 is negotiated, castling uses king-takes-rook, events stay chess.js-readable."""
import asyncio

import chess

from test_server import engine_cmd, needs_engine
from x3dchess_server.games import GameManager, view_fen, display_uci
from x3dchess_server.pool import EnginePool


def test_view_fen_hides_shredder_castling_but_not_standard():
    b = chess.Board.from_chess960_pos(100)
    assert view_fen(b).split(" ")[2] == "-" and b.shredder_fen().split(" ")[2] != "-"
    assert view_fen(chess.Board()) == chess.Board().fen()
    chess.Board(view_fen(b))                                   # the browser's chess.js accepts exactly this shape


def test_display_uci_shows_king_destination():
    b = chess.Board("4k3/8/8/8/8/8/8/RK3R2 w AF - 0 1", chess960=True)
    castle = next(m for m in b.legal_moves if b.is_castling(m) and b.is_queenside_castling(m))
    assert b.uci(castle) == "b1a1" and display_uci(b, castle) == "b1c1"


@needs_engine
def test_pool_plays_a_960_castle_when_it_wins():
    async def run():
        pool = EnginePool(engine_cmd(), size=1)
        await pool.start()
        try:
            r = await pool.search(chess.Board("4k3/8/8/8/8/8/8/RK3R2 w AF - 0 1", chess960=True), depth=6)
            assert chess.Move.from_uci(r["uci"]) is not None
        finally:
            await pool.close()
    asyncio.run(run())


@needs_engine
def test_manager_960_games_replay_legally_from_their_published_fen960():
    async def run():
        pool = EnginePool(engine_cmd(), size=2)
        await pool.start()
        gm = GameManager(pool, boards=4, depth=5, variant="960", seed=11)
        q = gm.register()
        await gm.start()
        try:
            last, seen, deadline = {}, 0, asyncio.get_event_loop().time() + 40
            while seen < 24 and asyncio.get_event_loop().time() < deadline:
                ev = await asyncio.wait_for(q.get(), 15)
                if ev["type"] == "snapshot_game":
                    assert ev["variant"] == "chess960" and ev["opening"].startswith("Chess960")
                    last[ev["game_id"]] = chess.Board(ev["fen960"], chess960=True)
                elif ev["type"] == "move":
                    board = last[ev["game_id"]]
                    mv = board.parse_san(ev["san"])           # the SAN is legal on the 960 board before the move
                    assert mv in board.legal_moves
                    board.push(mv)
                    assert board.shredder_fen().split(" ")[:2] == ev["fen960"].split(" ")[:2]
                    assert view_fen(board) == ev["fen"] and chess.Board(ev["fen"]).is_valid()
                    seen += 1
            assert seen >= 24
        finally:
            await gm.stop(); await pool.close()
    asyncio.run(run())


def test_manager_rejects_bad_variant_options():
    import pytest
    for kwargs in ({"variant": "atomic"}, {"variant": "960", "position": 960}, {"variant": "960", "position": -1}, {"position": 5}):
        with pytest.raises(ValueError):
            GameManager(None, boards=1, **kwargs)
    gm = GameManager(None, boards=2, variant="960", position=518)
    assert all(g.opening == "Chess960 · #518" and not g.board.move_stack for g in gm.games)
