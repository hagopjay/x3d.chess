"""Scaffold server: /health, /api/games, /events (SSE heartbeat). Real games arrive in phase 2."""
import asyncio, json
from aiohttp import web

async def health(_):  return web.json_response({"ok": True, "version": "0.0.1", "boards": 0})
async def games(_):   return web.json_response({"games": []})

async def events(req):
    r = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
    await r.prepare(req)
    try:
        while True:
            await r.write(b": heartbeat\n\n")
            await asyncio.sleep(15)
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    return r

def make_app():
    a = web.Application()
    a.add_routes([web.get("/health", health), web.get("/api/games", games), web.get("/events", events)])
    return a

if __name__ == "__main__":
    web.run_app(make_app(), host="127.0.0.1", port=8080)
