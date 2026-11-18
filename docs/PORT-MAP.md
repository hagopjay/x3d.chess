# Port map: backup module to x3d.chess

Line counts from the uploaded zip (`wc -l`). "Keep" = ported as-is; "Rework" = redesigned for X3D.

## Backend

| Module | Lines | Role | Target | Action |
|---|---|---|---|---|
| `game_manager.py` | 607 | 20 Stockfish processes, game loop, SSE fan-out | `pool.py` + `games.py` | Rework (engine pool) |
| `main.py` | 401 | aiohttp routes, SSE handler | `server.py` | Keep, extend |
| `game_state.py` | 376 | state, phase, status enums | `state.py` | Keep |
| `tactical_detector.py` | 496 | fork/pin/skewer/discovery/overloading | `analysis/tactics.py` + JS twin | Keep |
| `bifurcation_detector.py` | 227 | blunder/mistake/inaccuracy thresholds (1.0/0.5/0.2 pawns) | `analysis/critical.py` + JS twin | Keep |
| `convergence_tracker.py` | 397 | cross-game convergence, outliers (numpy) | `analysis/convergence.py` | Keep |
| `phase_space.py` | 180 | 3D game DNA (numpy) | `analysis/phase_space.py` | Keep |
| `draw_detector.py` | 346 | repetition, 50-move, material, stalemate | `analysis/draws.py` | Keep (python-chess has most of it) |
| `openings.py` | 161 | 10 openings (README says 10, BACKUP_README says 6) | `openings.py` | Keep |
| `position_cache.py`, `cache.py` | 174, 52 | FEN-normalised LRU, hit rate | `cache.py` | Keep |
| `desktop_app.py`, `build/`, pywebview/PyInstaller | n/a | desktop packaging | n/a | Dropped (decision 5A) |

## Frontend

| Module | Lines | Target | Action |
|---|---|---|---|
| `Board.tsx`, `ChessBoard.tsx`, `CanvasBoard.tsx` | 416, 261, 381 | `scene.js` + board PROTO | Rework |
| `BoardGrid.tsx` | 195 | grid layout of N boards | Rework |
| `EffectDispatcher.ts`, `VisualEffects.ts/.tsx` | 310, 219, 187 | X3D effects layer | Rework |
| `EvalBar.tsx`, `EvalTinter.ts`, `EvalGraph.tsx` | 95, 169, 393 | eval bar, tint, graph nodes | Rework |
| `PressureHeatmap.tsx` | 347 | `heat_*` overlays | Rework |
| `PhaseSpace.tsx` | 487 | 3D trajectory scene | Rework (native 3D) |
| `ConvergenceChart.tsx` | 395 | HUD polylines | Rework |
| `MoveList.tsx`, `StatusBar.tsx`, `GameModal.tsx` | 134, 184, 169 | HTML overlay + fly-to viewpoints | Rework |
| stores (`game`, `theme`, `settings`, `criticalMoments`) | 172, 333, 132, 196 | plain JS modules | Keep logic |

## Status

Backend analysis modules (tactics, critical moments, phase space, convergence, draws, openings) are copied unchanged into `server/x3dchess_server/`. The game manager was reworked around the engine pool. Frontend: board, grid, eval bar/tint, last-move and tactic overlay, phase space are done; heatmap, eval graph, convergence chart, modal, themes and capture/check FX are open (see [RESULTS.md](RESULTS.md)).
