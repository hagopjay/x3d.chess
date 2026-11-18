"""x3d.chess server: shared Stockfish pool, N boards, SSE fan-out.

  python -m x3dchess_server.server --engine /path/to/stockfish --boards 20 --pool 4 --depth 14
  python -m x3dchess_server.server --engine "node viewer/vendor/stockfish/stockfish-19-lite-single.js"   # no native binary

Routes (docs/PROTOCOL.md): /health /api/games /api/snapshot /api/stats /events
"""
import argparse
import asyncio
import json
import os
import shlex
import shutil
from pathlib import Path
from aiohttp import web

from .games import GameManager
from .pool import EnginePool


@web.middleware
async def cors(request, handler):
    resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


def make_app(gm: GameManager) -> web.Application:
    async def health(_):
        return web.json_response({"ok": True, "version": "0.1.0", **gm.stats()})

    async def games(_):
        return web.json_response({"games": [gm._snapshot_event(g) for g in gm.games]})

    async def stats(_):
        return web.json_response(gm.stats())

    async def game(request):
        g = next((g for g in gm.games if g.id == request.match_info["game_id"]), None)
        if g is None:
            raise web.HTTPNotFound(text="unknown game")
        return web.json_response(gm._snapshot_event(g))

    async def events(req):
        r = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                        "Access-Control-Allow-Origin": "*"})
        await r.prepare(req)
        q = gm.register()
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    payload = b": heartbeat\n\n"
                else:
                    if ev is None:
                        break
                    payload = f"data: {json.dumps(ev, allow_nan=False)}\n\n".encode()
                await asyncio.wait_for(r.write(payload), timeout=10)
        except (ConnectionResetError, BrokenPipeError, asyncio.TimeoutError):
            if req.transport is not None:
                req.transport.close()
            pass
        finally:
            gm.unregister(q)
        return r

    app = web.Application(middlewares=[cors])
    app.add_routes([web.get("/health", health), web.get("/api/games", games), web.get("/api/snapshot", games),
                    web.get("/api/games/{game_id}", game), web.get("/api/stats", stats), web.get("/events", events)])
    return app


def find_engine(arg: str | None) -> list[str]:
    if arg:
        if Path(arg).is_file():
            return [arg]
        words = shlex.split(arg, posix=os.name != "nt")
        if os.name == "nt":
            words = [s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'" else s for s in words]
        if not words:
            raise SystemExit("--engine must name an executable or command")
        return words
    exe = os.environ.get("STOCKFISH") or shutil.which("stockfish")
    if not exe:
        raise SystemExit("no engine: pass --engine, set STOCKFISH, or put stockfish on PATH")
    return [exe]


async def amain(a) -> None:
    pool = EnginePool(find_engine(a.engine), size=a.pool)
    gm, runner = None, None
    try:
        await pool.start()
        gm = GameManager(pool, boards=a.boards, depth=a.depth, seed=a.seed, variant=getattr(a, "variant", "standard"), position=getattr(a, "position", None))
        await gm.start()
        runner = web.AppRunner(make_app(gm), shutdown_timeout=2)
        await runner.setup()
        await web.TCPSite(runner, a.host, a.port).start()
        print(f"x3d.chess server: {a.boards} boards on {a.pool} engines at depth {a.depth} -> http://{a.host}:{a.port}/events", flush=True)
        await asyncio.Event().wait()
    finally:
        if gm is not None: await gm.stop()
        if runner is not None: await runner.cleanup()
        await pool.close()


def main() -> None:
    def within(name, low, high):
        def parse(raw):
            try:
                value = int(raw)
                if not low <= value <= high: raise ValueError
                return value
            except ValueError:
                raise argparse.ArgumentTypeError(f"{name} must be {low}–{high}") from None
        return parse
    p = argparse.ArgumentParser()
    p.add_argument("--engine"); p.add_argument("--boards", type=within("boards",1,64), default=20)
    p.add_argument("--pool", type=within("pool",1,16), default=min(4,max(1,(os.cpu_count() or 4)//2)))
    p.add_argument("--depth", type=within("depth",1,30), default=12); p.add_argument("--seed", type=int, default=1)
    p.add_argument("--variant", choices=("standard", "960"), default="standard", help="960 = Fischer Random (Chess960)")
    p.add_argument("--position", type=within("position",0,959), default=None, help="fixed Chess960 start id 0-959 (518 = standard array); default random per game")
    p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=within("port",1,65535), default=8080)
    a = p.parse_args()
    if a.position is not None and a.variant != "960":
        p.error("--position needs --variant 960")
    asyncio.run(amain(a))


if __name__ == "__main__":
    main()
