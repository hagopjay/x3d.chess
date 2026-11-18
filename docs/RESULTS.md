# Historical baseline measurements

These figures predate the observatory review and study-room extension. They
are retained as historical observations, not fresh validation of the changed
revision. Current evidence and native-browser limits are described in
[RUNTIME-VALIDATION.md](RUNTIME-VALIDATION.md). Comparisons with other hardware
are hypotheses, not guaranteed performance floors.

Recorded baseline environment: 4 vCPU Linux sandbox, Chromium (Playwright 1.63) with SwiftShader software GL, X_ITE 16.6.1, Stockfish 19 lite single-thread WASM (npm `stockfish` 19.0.1), Node 22. These numbers do not predict another machine's performance.

| Check | Result | Source |
|---|---|---|
| `board.x3d`, `grid.x3d` valid | both validate | `tools/validate.sh` (xmllint + official X3D 4.0 XSD) |
| 20 boards x 32 pieces, replay transport, 12 s | 614 pieces, 614 scene nodes, 0 misplaced, 0 console errors | `tools/smoke.mjs` |
| Browser engine, 3 workers, depth 10, 25 s | 144 searches, 8,672,044 nodes, 0 errors | `QUERY="?engine=wasm&pool=3&depth=10" tools/smoke.mjs` |
| Python server (3 engines, 20 boards, depth 10), 25 s SSE window | 595 `move`, 146 `phase_space_update`, 29 `convergence_update`, 20 snapshots | aiohttp SSE client script against `x3dchess_server.server` with `node stockfish-19-lite-single.js` as the UCI engine |
| Viewer fed by that server, 30 s | 612 moves, 298 with tactic lines, 151 phase points, 0 misplaced, 0 errors | `QUERY="?engine=sse&server=..." tools/smoke.mjs` |
| Engine speed, Italian position, lite single | depth 8: 37 ms, 10: 44 ms, 12: 128 ms, 14: 354 ms | Node 22 + Stockfish 19 lite single, `go depth N` |
| JS analysis twins vs Python (phase space, all 5 tactic patterns, critical moments) | 0 mismatches over 650 positions (3,749 tactic motifs) and 1,171 critical-moment steps | `tools/parity_gen.py` (python-chess 1.11 outputs) vs `tools/parity.mjs` (chess.js 1.4.0) |
| Browser-only Stockfish with JS twins, 25 s, depth 10, 3 workers | 141 searches, 13 moves with tactic lines, 30 critical flags, 24 phase points, 0 errors | `QUERY="?engine=wasm&pool=3&depth=10" tools/smoke.mjs` |
| Heatmap + eval graph overlays, wasm engine, 25 s, 20 boards | 20 of 20 boards painted and graphing, 0 misplaced pieces, 0 console errors | `QUERY="?engine=wasm&pool=3&depth=10&heat=1" tools/smoke.mjs` (`graphs` and `heat` counters) |
| Real mouse click on a board (TouchSensor) then fly-to and panel | selected board 0, camera settled, panel populated (opening, eval, skill, depth, SAN list) | `CLICK=305,100 tools/smoke.mjs` (Playwright mouse click) |
| Runtime theme switch + heatmap + wasm engine, 20 boards | 624 pieces = 624 scene nodes, 0 misplaced, 16 capture bursts, 0 console errors | `QUERY="?engine=wasm&pool=3&depth=10&heat=1" CYCLE=1 tools/smoke.mjs` |
| Server tests | 5 passed (openings, phase space, fork detector, mate-in-1 through the pool, 8 boards on 2 engines) | `pytest server/tests` |

## Lens overlays (18 Nov 2026)

| What | Measured | Source |
|---|---|---|
| Terrain vs independent attack counts | 609 checks, both modes | `tools/terrain-test.mjs`, python-chess 1.11 |
| Concept lens vs independent oracle | 50,112 checks over 327 positions | `tools/concepts-test.mjs`, `tools/concepts_gen.py` |
| Inspector legal sets | 100 random positions x 64 squares agree | `tools/inspector-test.mjs`, `tools/inspector_expect.py` |
| MultiPV branches, real engine | 4 FENs, MultiPV 3, depth 8: every PV verifies legally | `tools/branches-test.mjs`, vendored Stockfish 19 lite under Node |
| Skyline | 3,360 checks, 1 to 64 boards | `tools/skyline-test.mjs` |
| Native lens run, 8 boards, wasm depth 8 pool 2 | all five lenses exercised, 0 console errors, 0 misplaced pieces | `tools/lens-smoke.mjs`, Chromium 153 SwiftShader, `evidence/lens-smoke.json` |

## Known gaps (logged, not hidden)

| Gap | Plan |
|---|---|
| Native Stockfish and the Windows PC were not exercised; the server was tested with the WASM engine run under Node as a UCI process | run `--engine C:\path\stockfish.exe` on the PC and record numbers |
| glb piece set, sound, a per-theme heatmap palette | later |
| Browser depth defaults to 12, not the original 14-20 | configurable `?depth=`; raise once measured on a real GPU/CPU |
| Piece geometry is primitives | glb pieces via `Inline` once a set is chosen |
| X_ITE loaded from a pinned CDN | vendor locally with the Pages build |
| Original backup README says 10 openings, its backup notes say 6; code has 10 | ported the 10 |

## Original-detector quirks found while porting (kept faithfully; parity requires it)

| Module | Quirk | Effect |
|---|---|---|
| `bifurcation_detector` | swing is `abs(eval_after - eval_before)` with no mover sign | a move that wins a queen is flagged "blunder" like one that loses it; 653 of 1,171 random-eval steps flag |
| `tactical_detector.detect_pins` | steps from the pinned piece toward its own king and looks for an enemy slider there | finds a slider between piece and king, not a true pin |
| `tactical_detector.detect_discoveries` | geometric "between" test, no check that the line is otherwise clear or that moving reveals an attack | over-reports discoveries (the most common motif in server runs) |
| `tactical_detector.detect_overloading` | `is_attacked_by(not turn, ...)` heuristic, not per-defender | flags any piece when two of its side's rooks/queens are defended |
| all detectors | only the side to move is scanned for attacking motifs | the other side's tactics appear one ply later |

Fixing them is a separate, owner-approved change: the parity fixtures would be regenerated from corrected Python first.
