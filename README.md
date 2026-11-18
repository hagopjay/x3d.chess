# x3d.chess

Multi-board AI-vs-AI chess spectator, ported to **X3D**. Many Stockfish games at once, rendered as one X3D scene and driven through the X3D Scene Access Interface (SAI).

> Status: **scaffold** (phase 0). Boards, eval bar and a placeholder piece render and validate; the engine pool, protocol and analysis ports are specified but not built. See [docs/PLAN.md](docs/PLAN.md).

Ported from the owner's *chess-spectator* backup (Python/aiohttp/python-chess/Stockfish backend, React/Canvas/D3 frontend; about 9.5k lines, counted from the uploaded zip).

## What works today (phase 0)

| Check | Result | Source |
|---|---|---|
| `viewer/scenes/board.x3d` (64 squares + eval bar + 1 piece) | validates | `tools/validate.sh`: xmllint against the official Web3D X3D 4.0 XSD |
| Viewer loads, all 64 `sq_*` nodes resolve through SAI, 0 console errors | pass | `tools/smoke.mjs`: headless Chromium (Playwright 1.63) + SwiftShader, X_ITE 16.6.1 |
| Server answers `/health`, `/api/games`, `/events` | pass | aiohttp smoke call |

## Layout

```
docs/        ARCHITECTURE, PROTOCOL, X3D-MAPPING, PORT-MAP, PLAN, ATTRIBUTION
server/      x3dchess_server: protocol types, EnginePool (stub), aiohttp SSE app
viewer/      index.html, js/ (SAI wrapper, Transport contract), scenes/board.x3d
tools/       gen_board.py (scene generator), validate.sh (XSD gate), smoke.mjs (Chromium)
```

## Quick start

```bash
python3 tools/gen_board.py && tools/validate.sh          # generate + XSD gate
python3 -m http.server -d viewer 8000                    # open http://localhost:8000
pip install -r server/requirements.txt && python server/x3dchess_server/server.py
```

## Decisions (owner, 18 Nov 2026)

Renderer X_ITE first, Babylon FX port later. Stockfish via browser WASM workers for the public demo and a Python server for the owner's PC, same event protocol. 20 configurable boards. Everything except desktop packaging is kept. X3D-native 3D where it beats the 2D original. GPL-3.0.

## Licence

GPL-3.0-or-later (Stockfish and python-chess are GPL). See [LICENSE](LICENSE) and [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md).
