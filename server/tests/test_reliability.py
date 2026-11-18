"""Real lifecycle invariants, including failed/cancelled engine leases and SSE resync."""
import asyncio
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import chess
import chess.engine
import pytest

from x3dchess_server.games import GameManager, PLY_CAP
from x3dchess_server.openings import OPENING_BOOK
from x3dchess_server.pool import EnginePool
from x3dchess_server.server import make_app, amain, find_engine


class FakeTransport:
    def __init__(self, engine):
        self.engine, self.closed = engine, False

    def close(self):
        self.closed = True
        if not self.engine.returncode.done():
            self.engine.returncode.set_result(0)


class FakeEngine:
    def __init__(self, action="move"):
        self.action = action
        self.options = {"Threads": None, "Hash": None, "Skill Level": None}
        self.returncode = asyncio.get_running_loop().create_future()
        self.transport = FakeTransport(self)
        self.entered = asyncio.Event()

    async def configure(self, _):
        pass

    async def play(self, board, limit, info):
        self.entered.set()
        if self.action == "block":
            await asyncio.Event().wait()
        if self.action == "die":
            raise chess.engine.EngineTerminatedError("planted process exit")
        if self.action == "illegal":
            move = chess.Move.from_uci("e2e5")
        elif self.action == "none":
            move = None
        else:
            move = next(iter(board.legal_moves), None)
        score = chess.engine.Mate(0) if board.is_checkmate() else chess.engine.Cp(23)
        if self.action == "mategiven": score = chess.engine.MateGiven
        values = {"score": chess.engine.PovScore(score, chess.WHITE), "depth": 6, "nodes": 123}
        if self.action == "lowerbound": values["lowerbound"] = True
        return chess.engine.PlayResult(move, None, values)

    async def quit(self):
        self.transport.close()


def factory(engines):
    async def spawn(_):
        value = engines.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value.transport, value
    return spawn


def test_pool_partial_startup_closes_already_started_processes():
    async def check():
        first = FakeEngine()
        with patch("chess.engine.popen_uci", factory([first, OSError("planted startup failure")])):
            pool = EnginePool(["fixture"], size=2)
            with pytest.raises(OSError):
                await pool.start()
            assert first.transport.closed and pool.alive == 0
    asyncio.run(check())


def test_dead_or_illegal_engine_is_replaced_without_mutating_position():
    async def check(action):
        first, second = FakeEngine(action), FakeEngine()
        board = chess.Board(); before = board.fen()
        with patch("chess.engine.popen_uci", factory([first, second])):
            pool = EnginePool(["fixture"], size=1)
            await pool.start()
            with pytest.raises(chess.engine.EngineError):
                await pool.search(board, 6)
            answer = await asyncio.wait_for(pool.search(board, 6), 1)
            assert first.transport.closed and pool.launches == 2
            assert answer["eval_fen"] == before and board.fen() == before
            assert chess.Move.from_uci(answer["uci"]) in board.legal_moves
            await pool.close()
    for action in ("die", "illegal", "none"):
        asyncio.run(check(action))


def test_cancelled_search_retires_engine_and_waiting_lease_recovers():
    async def check():
        first, second = FakeEngine("block"), FakeEngine()
        with patch("chess.engine.popen_uci", factory([first, second])):
            pool = EnginePool(["fixture"], size=1); await pool.start()
            active = asyncio.create_task(pool.search(chess.Board(), 6))
            await first.entered.wait()
            waiting = asyncio.create_task(pool.search(chess.Board(), 6))
            active.cancel()
            with pytest.raises(asyncio.CancelledError): await active
            answer = await asyncio.wait_for(waiting, 1)
            assert answer["uci"] and first.transport.closed
            await pool.close()
    asyncio.run(check())


def test_close_cancels_active_and_waiting_searches():
    async def check():
        first = FakeEngine("block")
        with patch("chess.engine.popen_uci", factory([first])):
            pool = EnginePool(["fixture"], size=1); await pool.start()
            a = asyncio.create_task(pool.search(chess.Board(), 6))
            await first.entered.wait()
            b = asyncio.create_task(pool.search(chess.Board(), 6))
            await asyncio.sleep(0)
            await asyncio.wait_for(pool.close(), 1)
            assert a.cancelled() and b.cancelled() and pool.alive == 0
            assert first.transport.closed
            with pytest.raises(RuntimeError): await pool.search(chess.Board(), 6)
    asyncio.run(check())


def test_search_timeout_does_not_return_busy_process_to_pool():
    async def check():
        first, second = FakeEngine("block"), FakeEngine()
        with patch("chess.engine.popen_uci", factory([first, second])):
            pool = EnginePool(["fixture"], size=1, search_timeout=.01); await pool.start()
            with pytest.raises(asyncio.TimeoutError): await pool.search(chess.Board(), 6)
            assert first.transport.closed
            assert (await pool.search(chess.Board(), 6))["uci"]
            await pool.close()
    asyncio.run(check())


def test_mate_zero_does_not_turn_into_zero_centipawns():
    async def check(fen, action, expected):
        board = chess.Board(fen)
        assert board.is_valid() and board.is_checkmate()
        engine = FakeEngine(action)
        with patch("chess.engine.popen_uci", factory([engine])):
            pool = EnginePool(["fixture"], size=1); await pool.start()
            answer = await pool.search(board, 6)
            assert answer["mate"] == 0 and answer["mate_cp"] == expected
            await pool.close()
    asyncio.run(check("8/8/8/8/8/8/5kq1/7K w - - 0 1", "none", -1500))
    asyncio.run(check("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", "mategiven", 1500))


def test_configuration_bounds_reject_bool_zero_and_excessive_work():
    for size in (False, 0, 17):
        with pytest.raises(ValueError): EnginePool(["fixture"], size=size)
    with pytest.raises(ValueError): EnginePool("stockfish")
    for boards in (True, 0, 65):
        with pytest.raises(ValueError): GameManager(None, boards=boards)
    with pytest.raises(ValueError): GameManager(None, depth=31)


def test_initial_snapshots_are_real_openings_with_unknown_evaluation():
    gm = GameManager(None, boards=4)
    queue = gm.register()
    for _ in range(4):
        snap = queue.get_nowait()
        assert snap["fen"] != chess.STARTING_FEN
        assert snap["start_fen"] == snap["fen"] and snap["generation"] == 1
        assert snap["eval_cp"] is None and snap["eval_fen"] is None


def test_slow_client_gets_close_sentinel_instead_of_heartbeat_only_stream():
    gm = GameManager(None, boards=1, client_queue_size=2)
    queue = gm.register()
    gm.emit({"type":"one"}); gm.emit({"type":"two"})
    assert queue not in gm.clients and queue.get_nowait() is None
    new = gm.register().get_nowait()
    assert new["type"] == "snapshot_game" and new["seq"] == 2


def test_terminal_results_and_adjudications_are_recovered_by_snapshot():
    gm = GameManager(None, boards=1); g = gm.games[0]
    cases = [
        ("8/8/8/8/8/8/5kq1/7K w - - 0 1", "checkmate", "0-1", False),
        ("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "stalemate", "1/2-1/2", False),
        ("8/8/8/8/8/4k3/8/4K3 w - - 0 1", "insufficient_material", "1/2-1/2", False),
        ("8/8/8/8/8/4k3/6R1/4K3 w - - 100 1", "fifty_move", "1/2-1/2", True),
        ("8/8/8/8/8/4k3/6R1/4K3 w - - 150 1", "seventyfive_move", "1/2-1/2", False),
    ]
    for fen, reason, result, adjudicated in cases:
        g.new_game(); g.board = chess.Board(fen)
        assert g.board.is_valid() and gm._complete_if_ready(g)
        snap = gm.register().get_nowait()
        assert (snap["state"],snap["reason"],snap["result"],snap["adjudicated"]) == ("complete",reason,result,adjudicated)
    g.new_game(); g.ply = PLY_CAP
    assert gm._complete_if_ready(g) and g.reason == "ply_cap" and g.adjudicated


def test_repetition_uses_the_actual_move_stack_and_distinguishes_fivefold():
    gm = GameManager(None, boards=1); g = gm.games[0]
    for repeats, expected in [(2,"threefold"),(4,"fivefold")]:
        g.new_game(); g.board = chess.Board()
        for _ in range(repeats):
            for san in ("Nf3","Nf6","Ng1","Ng8"): g.board.push_san(san)
        assert gm._complete_if_ready(g) and g.reason == expected


def test_illegal_engine_reply_does_not_kill_game_or_claim_a_draw():
    async def check():
        class Pool:
            def __init__(self): self.calls = 0
            async def search(self, board, depth, skill):
                self.calls += 1
                if self.calls > 2: await asyncio.Event().wait()
                return {"uci":"e2e5" if self.calls == 1 else next(iter(board.legal_moves)).uci(),
                        "cp":23,"mate":None,"depth":6,"nodes":1,"eval_fen":board.fen()}
        pool = Pool(); gm = GameManager(pool, boards=1); queue = gm.register()
        queue.get_nowait(); g = gm.games[0]; before = g.board.fen()
        original_sleep = asyncio.sleep
        async def quick(_): await original_sleep(0)
        with patch("x3dchess_server.games.asyncio.sleep", quick):
            task = asyncio.create_task(gm._loop(g))
            event = await asyncio.wait_for(queue.get(), 1)
            assert event["type"] == "move" and event["ply"] == 1
            assert event["eval_fen"] == before and event["eval_ply"] == 0
            assert event["fen"] != before and g.state == "playing" and len(g.history) == 1
            task.cancel(); await asyncio.gather(task, return_exceptions=True)
    asyncio.run(check())


def test_python_and_browser_openings_match_every_fen_field_and_history():
    repo = Path(__file__).resolve().parents[2]
    source = "import {OPENINGS} from './viewer/js/openings.js';console.log(JSON.stringify(OPENINGS));"
    answer = subprocess.check_output(["node","--input-type=module","-e",source],cwd=repo,text=True)
    for row in json.loads(answer):
        op = OPENING_BOOK[row["id"]]
        assert row["fen"] == op.fen and row["moves"] == list(op.moves)
        assert op.board().fen() == op.fen and len(op.board().move_stack) == op.moves_played
    assert OPENING_BOOK["french"].board().piece_at(chess.E5) == chess.Piece(chess.PAWN,chess.WHITE)
    assert OPENING_BOOK["english"].board().piece_at(chess.C4) == chess.Piece(chess.PAWN,chess.WHITE)
    assert OPENING_BOOK["reti"].board().piece_at(chess.F3) == chess.Piece(chess.KNIGHT,chess.WHITE)


def test_score_bounds_are_retained_and_not_compared_as_exact_swings():
    async def check():
        engine = FakeEngine("lowerbound")
        with patch("chess.engine.popen_uci", factory([engine])):
            pool = EnginePool(["fixture"], size=1); await pool.start()
            answer = await pool.search(chess.Board(), 6)
            assert answer["score_bound"] == "lowerbound"
            await pool.close()
        gm = GameManager(None, boards=1);g = gm.games[0];g.eval_cp = 23
        class RefuseSample:
            def add_position(self, *args): raise AssertionError("A bound was sampled as an exact evaluation")
        g.bifurcation = RefuseSample()
        _, critical = gm._analyse(g, {"mate":None,"score_bound":"lowerbound"}, "e2e4")
        assert critical is None and not isinstance(g.bifurcation, RefuseSample)
    asyncio.run(check())


def test_real_http_snapshot_and_slow_sse_reconnect_boundary():
    async def check():
        from aiohttp.test_utils import TestClient, TestServer
        pool = SimpleNamespace(size=1, searches=0, nodes=0, busy_s=0., alive=1, failures=0, launches=1)
        gm = GameManager(pool, boards=1, client_queue_size=2)
        async with TestClient(TestServer(make_app(gm))) as client:
            response = await client.get('/api/games/g0')
            payload = await response.json()
            assert response.status == 200 and payload["state"] == "playing" and payload["eval_cp"] is None
            assert (await client.get('/api/games/absent')).status == 404
            health = await (await client.get('/health')).json()
            assert health['draw_policy'] == 'claim_available' and health['engines_alive'] == 1
            stream = await client.get('/events')
            line = await asyncio.wait_for(stream.content.readline(),1)
            assert json.loads(line.decode()[6:])['type'] == 'snapshot_game'
            assert await stream.content.readline() == b'\n'
            gm.emit({'type':'one'});gm.emit({'type':'two'});gm.emit({'type':'three'})
            assert await asyncio.wait_for(stream.content.read(),1) == b''
            assert not gm.clients
    asyncio.run(check())


def test_server_startup_failure_still_cleans_games_runner_and_pool():
    async def check():
        calls = []
        class Pool:
            async def start(self): calls.append('pool.start')
            async def close(self): calls.append('pool.close')
        class Manager:
            async def start(self): calls.append('games.start')
            async def stop(self): calls.append('games.stop')
        class Runner:
            async def setup(self): raise OSError('planted bind/setup error')
            async def cleanup(self): calls.append('runner.cleanup')
        args=SimpleNamespace(engine='fixture',pool=1,boards=1,depth=6,seed=1,host='127.0.0.1',port=1234)
        with patch('x3dchess_server.server.EnginePool',return_value=Pool()), \
             patch('x3dchess_server.server.GameManager',return_value=Manager()), \
             patch('x3dchess_server.server.web.AppRunner',return_value=Runner()):
            with pytest.raises(OSError): await amain(args)
        assert calls == ['pool.start','games.start','games.stop','runner.cleanup','pool.close']
    asyncio.run(check())


def test_engine_executable_path_with_spaces_is_one_argument(tmp_path):
    target = tmp_path/'engine directory'/'stockfish'
    target.parent.mkdir();target.write_bytes(b'fixture, not executed')
    assert find_engine(str(target)) == [str(target)]
