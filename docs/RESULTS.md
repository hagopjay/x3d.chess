# Measured results

Every number names its source. Container: 4 vCPU Linux sandbox, Chromium (Playwright 1.63) with SwiftShader software GL, X_ITE 16.6.1, Stockfish 19 lite single-thread WASM (npm `stockfish` 19.0.1), Node 22. A real GPU and a native Stockfish will be faster; these are floors, not claims about the owner's PC.

| Check | Result | Source |
|---|---|---|
| `board.x3d`, `grid.x3d` valid | both validate | `tools/validate.sh` (xmllint + official X3D 4.0 XSD) |
| 20 boards x 32 pieces, replay transport, 12 s | 614 pieces, 614 scene nodes, 0 misplaced, 0 console errors | `tools/smoke.mjs` |
| Browser engine, 3 workers, depth 10, 25 s | 144 searches, 8,672,044 nodes, 0 errors | `QUERY="?engine=wasm&pool=3&depth=10" tools/smoke.mjs` |
| Python server (3 engines, 20 boards, depth 10), 25 s SSE window | 595 `move`, 146 `phase_space_update`, 29 `convergence_update`, 20 snapshots | aiohttp SSE client script against `x3dchess_server.server` with `node stockfish-19-lite-single.js` as the UCI engine |
| Viewer fed by that server, 30 s | 612 moves, 298 with tactic lines, 151 phase points, 0 misplaced, 0 errors | `QUERY="?engine=sse&server=..." tools/smoke.mjs` |
| Engine speed, Italian position, lite single | depth 8: 37 ms, 10: 44 ms, 12: 128 ms, 14: 354 ms | Node 22 + Stockfish 19 lite single, `go depth N` |
| Server tests | 5 passed (openings, phase space, fork detector, mate-in-1 through the pool, 8 boards on 2 engines) | `pytest server/tests` |

## Known gaps (logged, not hidden)

| Gap | Plan |
|---|---|
| Browser transports (`replay`, `wasm`) emit no tactics, critical moments or phase space; only the Python server does | JS twins of the analysis modules, parity-tested against the Python ones (phase 3b) |
| Native Stockfish and the Windows PC were not exercised; the server was tested with the WASM engine run under Node as a UCI process | run `--engine C:\path\stockfish.exe` on the PC and record numbers |
| Pressure heatmap, eval graph, check flash, capture particles, game modal, themes not built | phase 4 |
| Browser depth defaults to 12, not the original 14-20 | configurable `?depth=`; raise once measured on a real GPU/CPU |
| Piece geometry is primitives | glb pieces via `Inline` once a set is chosen |
| X_ITE loaded from a pinned CDN | vendor locally with the Pages build |
| Original backup README says 10 openings, its backup notes say 6; code has 10 | ported the 10 |
