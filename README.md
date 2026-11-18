# x3d.chess

Multi-board AI-vs-AI chess spectator, ported to **X3D**. Many Stockfish games at once, rendered as one X3D scene and driven through the X3D Scene Access Interface (SAI).

> Status: **phases 1-4 done**: 20-board X3D grid, real Stockfish games in the browser (WASM) or from a Python server, tactic lines, last-move highlights and a 3D phase-space view. Measured results and the known-gaps table are in [docs/RESULTS.md](docs/RESULTS.md); next steps in [docs/PLAN.md](docs/PLAN.md).

Ported from the owner's *chess-spectator* backup (Python/aiohttp/python-chess/Stockfish backend, React/Canvas/D3 frontend; about 9.5k lines, counted from the uploaded zip).

## What works today

| Capability | Where |
|---|---|
| 20 boards (5x4, configurable), 32 pieces each, move animation, eval bar and eval-tinted boards | `viewer/` (X_ITE, SAI) |
| Three interchangeable transports: `wasm` (Stockfish 19 in Web Workers; the default), `sse` (Python server), `replay` (no engine, labelled on the page) | `?engine=wasm|sse|replay` |
| One shared engine pool serving all boards (20 boards on 3 engines tested) | `server/x3dchess_server/pool.py`, `viewer/js/engine-pool.js` |
| Tactic lines, last-move highlight, 3D phase space with trails (server mode) | `viewer/js/fx.js`, `phasespace.js` |
| Analysis ported from the original: tactics, critical moments, phase space, convergence (Python), plus JS twins of the first three for browser-only mode, parity-tested | `server/x3dchess_server/analysis/`, `viewer/js/analysis.js`, `tools/parity.mjs` |
| Capture and check cues, last-move highlight, tactic lines | `viewer/js/fx.js` |
| Click a board to fly to it (TouchSensor, eased camera), game panel with move list and eval sparkline, arrows and Esc; themes (`t`, `?theme=moss|sage|mint|neon|classic|ice`; default `moss`, a low-glare green); capture bursts (`ParticleSystem`) | `viewer/js/camera.js`, `panel.js`, `themes.js`, `particles.js` |
| Pressure heatmap (toggle `h` or the button, `?heat=1`) and per-board eval graph | `viewer/js/overlays.js` |
| XSD gate, headless-Chromium smoke, pytest | `tools/`, `server/tests/` |

## Layout

```
docs/        ARCHITECTURE, PROTOCOL, X3D-MAPPING, PORT-MAP, PLAN, ATTRIBUTION
server/      x3dchess_server: protocol types, EnginePool (stub), aiohttp SSE app
viewer/      index.html, js/ (SAI wrapper, Transport contract), scenes/board.x3d
tools/       gen_grid.py, gen_board.py (scene generators), validate.sh (XSD gate), smoke.mjs (Chromium)
```

## Quick start

```bash
python3 tools/gen_grid.py && tools/validate.sh                      # generate scenes + XSD gate
python3 -m http.server -d viewer 8000                               # no server needed:
#   http://localhost:8000/?boards=20&depth=12                          Stockfish in the browser (the default)
#   http://localhost:8000/?engine=replay                               engine-free demo (material proxy, labelled on the page)

# PC server (native Stockfish): the viewer then uses ?engine=sse
pip install -r server/requirements.txt
cd server && python -m x3dchess_server.server --engine C:\\path\\stockfish.exe --boards 20 --pool 4 --depth 14
#   http://localhost:8000/?engine=sse&server=http://127.0.0.1:8080/events
```

## Decisions (owner, 18 Nov 2026)

Renderer X_ITE first, Babylon FX port later. Stockfish via browser WASM workers for the public demo and a Python server for the owner's PC, same event protocol. 20 configurable boards. Everything except desktop packaging is kept. X3D-native 3D where it beats the 2D original. GPL-3.0.

## Licence

GPL-3.0-or-later (Stockfish and python-chess are GPL). See [LICENSE](LICENSE) and [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md).
