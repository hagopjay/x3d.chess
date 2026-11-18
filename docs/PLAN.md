# Plan

| Phase | Deliverable | Gate |
|---|---|---|
| 0 Scaffold (done) | repo, docs, board scene, stubs | XSD + Chromium smoke pass |
| 1 Boards (done, with generated games instead of PGN) | 20-board grid PROTO, all 32 pieces, move animation from a recorded PGN (no engine) | XSD, Chromium, frame time recorded |
| 2 Engine (done; native Stockfish on the PC still to measure) | EnginePool (native) + SSE; WasmTransport (stockfish.wasm); same event stream | both transports replay-equal for a fixed seed/depth |
| 3 Analysis (3a and 3b done: Python ports plus JS twins with a parity gate; quirk fixes open (see RESULTS)) | tactics, critical moments, draws, phase space, convergence, heatmap, openings, cache (Python + JS twins) | parity test over a FEN set |
| 4 Spectator UX | eval bar/graph/tint, focus board, modal fly-to, themes | Chromium screenshots |
| 5 Publish | GitHub Pages demo, Demo 42 card via three.js bridge thread | live URL |
| 6 Babylon FX | Babylon renderer with the neon/particle FX | owner's request, after 5 |

Foldback: lessons to x3d.loom (PR) and x3d.docs after phase 2 and 5. Spend: $0 throughout. Every number in docs names its source.
