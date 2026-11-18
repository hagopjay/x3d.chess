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

    async def events(req):
        r = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                        "Access-Control-Allow-Origin": "*"})
        await r.prepare(req)
        q = gm.register()
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    await r.write(f"data: {json.dumps(ev)}\n\n".encode())
                except asyncio.TimeoutError:
                    await r.write(b": heartbeat\n\n")
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        finally:
            gm.unregister(q)
        return r

    app = web.Application(middlewares=[cors])
    app.add_routes([web.get("/health", health), web.get("/api/games", games), web.get("/api/snapshot", games),
                    web.get("/api/stats", stats), web.get("/events", events)])
    return app


def find_engine(arg: str | None) -> list[str]:
    if arg:
        return shlex.split(arg, posix=os.name != "nt")
    exe = os.environ.get("STOCKFISH") or shutil.which("stockfish")
    if not exe:
        raise SystemExit("no engine: pass --engine, set STOCKFISH, or put stockfish on PATH")
    return [exe]


async def amain(a) -> None:
    pool = EnginePool(find_engine(a.engine), size=a.pool)
    await pool.start()
    gm = GameManager(pool, boards=a.boards, depth=a.depth, seed=a.seed)
    await gm.start()
    runner = web.AppRunner(make_app(gm))
    await runner.setup()
    await web.TCPSite(runner, a.host, a.port).start()
    print(f"x3d.chess server: {a.boards} boards on {a.pool} engines at depth {a.depth} -> http://{a.host}:{a.port}/events", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await gm.stop(); await pool.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--engine"); p.add_argument("--boards", type=int, default=20)
    p.add_argument("--pool", type=int, default=max(1, (os.cpu_count() or 4) // 2))
    p.add_argument("--depth", type=int, default=12); p.add_argument("--seed", type=int, default=1)
    p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=int, default=8080)
    asyncio.run(amain(p.parse_args()))


if __name__ == "__main__":
    main()
