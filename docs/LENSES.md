# Lenses: 3D evaluation and advanced chess concepts

Five opt-in overlays sit on top of the arena. Each one answers a named question about a position, carries its own legend, and is created once, painted synchronously after its last `await`, and guarded by a per-lens revision plus the board epoch (`viewer/js/lenses.js`). Defaults are off, so the baseline scene is unchanged.

| Lens | Button / key | Question it answers | Module | Honest label |
|---|---|---|---|---|
| Terrain | Terrain / `G` (`Shift+G` switches mode) | Where is attack pressure concentrated? | `terrain.js` | Column height is the absolute attack-count balance (white attackers minus black), or the absolute difference of attacker value sums (P1 N3 B3 R5 Q9, K0). Cyan = white ahead, magenta = black ahead, gold cap = clipped at 6 / 12. Static, geometric, pins still count. Not mobility, not SEE, not an engine score. |
| Concept lens | Concepts / `C` (cycles one concept per picture) | Which structural or tactical fact is true here? | `concepts.js` | 13 concepts: hanging pieces, static exchange estimate (SEE), isolated, doubled, passed, backward and connected pawns, pawn islands, outposts, open and half-open files with rooks, king-zone pressure, mobility, bishop pair. Each is a rule on one position, with a stated definition; none looks ahead. SEE is a static estimate, never "wins". |
| Square inspector | Inspector / `I`, then arrows or WASD, click a square, `Esc` | What relations touch this square, and which are legal? | `inspector.js` | Geometric attackers and defenders, legal destinations (chess.js: pins, checks, castling, en passant), absolute pin rays, x-ray batteries. A pinned attacker is shown dimmed (`attackLegalToPlay=false`); defenders and pawn diagonals onto empty squares report `null`, not `false`. |
| Engine lines | Engine lines / `L` (again to resume) | What does the engine prefer here? | `branches.js` + `WasmEnginePool.analyze` | The focused game is paused so the position stays still, then MultiPV 3 at depth 10 draws up to three arcs. Every principal variation is replayed legally in chess.js before it is drawn; a result for any other FEN is dropped. Scores keep mate, bounds and null distinct and are shown from White's side. These are selected engine continuations, not a move tree or a proof. |
| Skyline | Skyline / `K` | How are all boards doing at once? | `skyline.js` | One column per board above the grid, height `clamp(cp/100, -6, 6) x 0.4`, plus a 60-ply eval ribbon behind each board. Mate is a typed flat cap and label, bounds are hollow, a missing score is a grey slab (not zero), and the ribbon breaks at every gap or mate instead of interpolating. Not a probability. |

## Interaction details

- Clicking a board selects it and flies the camera there, as before. With the inspector on, the click also reads the TouchSensor hit point (`ChessBoard.hitPoint`, new outputOnly field) and inspects the square under the pointer.
- While the inspector is on, arrows and WASD move the cursor over the focused board; `Esc` clears the square, a second `Esc` leaves the board.
- Engine lines hold the focused game before its next move is applied (`WasmTransport.holdGame` / `releaseGame`). Without a hold, a live game moves within a second and every result would be stale.
- On any new placement the inspector re-inspects its square against the new FEN, branches are cleared, and terrain and concept overlays repaint. A reset or new generation clears every claim tied to the old episode, including the ribbon history.

## Evidence

| Gate | Command | Result (this container) |
|---|---|---|
| Terrain, independent oracle | `node tools/terrain-test.mjs` | 609 checks, both modes vs python-chess, XSD and semantics pass |
| Concepts, independent oracle | `node tools/concepts-test.mjs` | 50,112 checks over 327 positions (random play plus classics), python-chess 1.11 oracle, mutated fixtures detected |
| Inspector | `node tools/inspector-test.mjs` | 35 tests, 100 random positions x 64 squares vs python-chess, FIDE study positions |
| Branches | `node tools/branches-test.mjs` | 9 groups including real vendored Stockfish MultiPV 3 at depth 8 on three FENs; corrupted PV and stale FEN rejected |
| Skyline | `node tools/skyline-test.mjs` | 3,360 checks, 1 to 64 boards, 7 documents validated |
| Hold for analysis | `node tools/transport-tests.mjs` | held game does not advance, play resumes on release |
| Native browser | `QUERY="?engine=wasm&boards=8&depth=8&pool=2" node tools/lens-smoke.mjs` | terrain on 8 of 8 boards, 13 concepts cycled, inspector by keyboard and real mouse click, engine lines drawn (3 verified PVs) with the game held then released, skyline 8 columns; 0 console errors, 0 misplaced pieces |

Rig for the browser row: Chromium 153.0.8010.12, SwiftShader (software GL), Playwright 1.63, X_ITE vendored locally. No frame-rate or GPU claim.

Adversarial review per module fixed real defects, each with a regression test: `groupFlat` could loop forever on `k=0`; a UCI `wdl` field made a lowerbound read as exact; arc apexes sat off the drawn path; a duplicate rank was labelled but never drawn; defender rays were dimmed as if illegal; small negative scores were drawn above the baseline and rounded to "0.0"; a reported 0 cp vanished on the ribbon; concept flags spilled onto neighbouring squares.

## Limits

- Terrain heights show magnitude only; sign is colour. Terrain and the heat overlay share a plane, so show one at a time.
- Concept definitions are deliberately conservative (for example backward pawns). They are counting rules, not strategic verdicts.
- Engine lines need the browser engine arena (`engine=wasm`). The UCI server transport has no analysis endpoint yet.
- Terrain and concepts repaint on every move of every board when on; with 20 boards on software GL that costs frames. Measure on real hardware before relying on it.
