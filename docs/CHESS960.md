# Chess960 (Fischer Random)

Chess960 is a first-class rules mode, not a skin. Choose it in the header (RULES), or with a URL / flag:

| Where | How |
|---|---|
| Browser | `?variant=960` (random start every game), `?variant=960&pos=518` (fixed start; 518 = the standard array), works with `engine=wasm` and `engine=replay` |
| Python server | `python -m x3dchess_server.server --variant 960 [--position 0-959]` |

Start positions use the Scharnagl numbering (0–959) shared by python-chess and Wikipedia; the panel shows `Chess960 · #id`.

## How it works

* **Rules** (`viewer/js/chess960.js`). chess.js has no 960 castling (it would emit a bogus `O-O` for a king on b1). `Chess960`
  extends it with castling held as "-", generates castling itself from per-rook-file rights, and performs it with chess.js's own
  null move so move numbers, the 50-move clock and history stay right. Legal-move generation checks the empty path, every
  square the king crosses, and the final position (moving the castling rook can open a line onto the king).
* **FENs.** `fen()` is chess.js-compatible (castling `-`), so every overlay (terrain, concepts, inspector, skyline, branches)
  keeps working unchanged. `fen960()` is the full Shredder-FEN (`HAha`) the engine and python-chess need. Events carry both.
* **UCI.** Stockfish runs with `UCI_Chess960` set per search; castling is king-takes-own-rook (`e1h1`) in the engine and in
  `engine_uci`; `uci` on events is king → destination so board highlights still make sense.
* **Engine lines (L).** PVs are verified against the Shredder-FEN (`engineFen`), so a line that castles is drawn, not dropped.
* **Python.** python-chess `chess960=True`; the pool already negotiates `UCI_Chess960`. `view_fen` hides the castling field
  from browser-facing `fen`/`eval_fen`/`start_fen`; `fen960` carries the rights.

## Checks (all in `npm test`)

| Check | What it proves |
|---|---|
| `tools/chess960-test.mjs` | all 960 starts equal python-chess; 260 castling-biased games / ~25k plies compared ply-by-ply: legal-move set, SAN, FEN, check, mate, stalemate, insufficient material, 50-move, threefold; 235+ castles over four castle kinds; hand-built edge cases (king stays, rook lands on king square, shielded rook, castle out of / through check, undo) |
| `tools/chess960-engine-test.mjs` | the real vendored Stockfish plays 46 moves on 3 random 960 starts through `WasmTransport`; every move is legal on the mirror, SAN/FEN agree, a castle in the UCI history is accepted, analysis stays bound to the overlay FEN |
| `server/tests/test_chess960.py` | real engine games from the Python server replay legally from their published `fen960`; browser-facing FEN is chess.js-readable |
| browser smoke | `QUERY='?engine=wasm&variant=960&boards=4&depth=4' node tools/smoke.mjs` — 45 real WASM moves, 0 console errors (software GL; no frame-rate claim) |

## Known limits

* `chess.moves()` on a `Chess960` object excludes castling (the overlays that call it on `new Chess(fen)` positions
  never see castling either); use `legalMoves960()` / `legalUci()` for the complete set.
* Terrain / concepts / inspector lenses read the compat FEN, so castling *rights* are not part of their analysis.
* The Python server's threefold/fivefold use python-chess's rights-aware counting; the browser uses its own
  rights-aware count (`repetitionCount()`), checked against python-chess in the oracle test.
