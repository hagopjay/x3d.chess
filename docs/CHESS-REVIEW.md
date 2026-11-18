# x3d.chess: technical and creative review

Review date: 17 November 2026, America/New_York. Baseline inspected:
`dea017f6b4e13abdbbe11553aeac131a3d80704d`.

The project already has a useful identity: a multi-game chess observatory whose
boards, pieces, traces, overlays and picking belong to an actual X3D scene. The
bounded engine pool, interchangeable transports and Python/JavaScript analysis
twins are good foundations. The strongest extension is an explanatory spectator:
keep the tournament overview, then let a focused board reveal the relationships
and counterexamples behind a position.

The important engineering boundary is between chess state, analysis claims and
their visual representation. A legal move, an engine preference, a geometric
attack relation and an attractive animation are four different observations.
Giving them explicit identities and labels makes the project more educational
and easier to test.

This document is a baseline assessment. Source paths and line references below
describe that commit; the implementation pass may repair them. The final PR and
executed check records should state which findings were addressed. This review
does not report a fresh native-browser or GPU benchmark. It contains fresh
source inspection, a generated-scene coordinate comparison and one rules-library
counterexample. The existing measurements in `docs/RESULTS.md` remain historical
results for their named environment.

## What is strong

| Existing design | Why it is worth preserving |
|---|---|
| `ChessBoard` PROTO plus named SAI fields | A small scene contract separates board appearance from game events. |
| One engine pool for many games | Resource use can be controlled independently of the number of visible boards. |
| Transport event contract | Browser WASM, native-server SSE and labeled replay can share the view. |
| Pure analysis modules and parity fixture | The two language implementations can be compared systematically. |
| Actual X3D attack lines, heatmap, graph and feature-space trails | The 3D medium is already carrying information, not merely a board texture. |
| Recorded known quirks | Preserving a reproducible baseline makes corrections measurable. |

Keep the replay mode explicit: its score is a material proxy, not Stockfish.
Likewise, preserve the side-to-move and score perspective in every analysis
record. The same numeric centipawn value interpreted from the wrong side can
reverse the meaning of a graph while leaving the scene visually plausible.

## Prioritized baseline findings

### F01 — P1: configurable board counts can move pieces off their boards

`tools/gen_grid.py:50–54` writes a fixed 5×4 scene by default. In contrast,
`viewer/js/scene.js` computes row centering from `Math.ceil(boards / cols)`.
Consequently, the static `board_0` remains at the four-row origin when a smaller
query configuration recenters its pieces for fewer rows. Counts above twenty
also request PROTO instances that do not exist.

A fresh standard-library XML comparison of the retained scene and the actual
viewer-origin formula produced:

| Requested boards | Origins that disagree | Missing PROTO instances |
|---:|---:|---:|
| 1 | 1 | 0 |
| 5 | 5 | 0 |
| 6 | 6 | 0 |
| 15 | 15 | 0 |
| 16 | 0 | 0 |
| 20 | 0 | 0 |
| 21 | 20 | 1 |

Use one layout specification for generation, runtime origins, cameras and the
allowed board count. Alternatively, derive each view's origin from the actual
PROTO translation. Test at least one partial row, one small grid and the maximum
supported configuration. A twenty-board smoke test alone cannot expose this
configuration defect.

### F02 — P1: async creation needs a committed-state boundary

X_ITE documents `createX3DFromString` as a Promise. That means every fragment
creation can yield between intent and scene insertion. The baseline contains
several concrete race opportunities:

- `BoardView.pushEval` sets `graph = true` before awaiting graph creation, then
  later calls may dereference `graphScene` before it exists (`board.js:80–89`).
- Two rapid `setHeat(true)` calls can both create a heatmap; a late creation can
  also arrive after a toggle-off (`board.js:67–74`).
- A rejected `busy` or `fxBusy` Promise prevents subsequent chained operations
  from executing (`board.js:38`, `:59`, `:125`).
- `scene.onEvent` starts FX and graph updates without awaiting their completion;
  `settled()` only waits for piece reconciliation.

Use one initialization Promise per resource, an explicit desired visibility
state, and a generation/revision check before committing a parsed fragment.
Recover an operation queue after reporting a failure. Make a full scene
settled barrier include pieces, overlays and effects relevant to a measurement.
These are scheduling contracts, not evidence that every race occurred in a
particular recorded browser run.

Primary API reference: [X_ITE Browser Services](https://create3000.github.io/x_ite/reference/browser-services/).

### F03 — P1: a new game must clear the previous visual claim

Snapshots replace `GameRecords`, but `resetEvals()` clears only the array, leaving
the old graph coordinates visible until another update. The phase-space `reset`
similarly clears its trail array without clearing the rendered line or hiding
the previous dot. The panel updates its tactic text only when a nonempty tactic
list arrives, so an old tactic can remain after the next position has none.

Treat a snapshot/new episode as an atomic reset of board state, evaluation
history, tactical annotations, check/capture cues, phase point/trail and any
selected-position explanation. Match event order with an episode identity and
monotone sequence or ply; a delayed old-game update must not reanimate an old
claim. The board's complete current FEN is authoritative for placement, while
game history remains necessary for history-dependent rules and explanations.

### F04 — P1: parity preserves behavior, including known incorrect behavior

The baseline explicitly preserves incorrect pin, discovery and overload
detectors and an absolute-evaluation-swing “blunder” classification. A Python/JS
parity pass is evidence of agreement between implementations. It cannot turn
these heuristics into chess truth.

Corrected analysis needs a small independent known-answer corpus before broad
random parity: true and false pins, obstructed discoveries, legal and illegal
captures, and a move whose evaluation improves for its mover. Distinguish a
geometric motif from a proved material gain. A fork can attack defended pieces;
an engine line or exchange analysis is needed for a stronger winning claim.

For move quality, record the side whose move is judged and the exact positions
whose evaluations are compared. Search depth, bounds, mate scores and available
candidate lines also belong in the record. Regenerate parity after correcting
the shared specification; do not preserve a known defect merely to keep an old
fixture green.

### F05 — P1: the heatmap is attack-count balance

`controlGrid` counts white attackers minus black attackers per square. This is
not legal-move count, exchange outcome, probability of capture or engine
evaluation. FIDE explicitly treats a piece as attacking a square even when a
move there would expose its own king. A pinned piece can therefore contribute
to an attack map without being able to play that move.

Label the display **attack-count balance**, state cyan/white-positive and
magenta/black-positive in a persistent legend, and explain saturation. The
baseline alpha caps at 0.6, so visually equal opacity can represent unequal
counts. Let a selected square reveal the actual attacking pieces; comparing
attack relations with legal moves is a valuable teaching feature.

Primary rule reference: [FIDE Laws, Article 3.1.3](https://handbook.fide.com/chapter/e012023).

### F06 — P2: feature space compresses a position; it does not identify it

The existing axes are a useful authored feature map:

- Material: the signed sum with P=1, N=3, B=3, R=5, Q=9.
- Space: a weighted attacker-count difference, normalized and clamped.
- King safety: pawn-shield and nearby-enemy heuristics.

The view clamps each displayed coordinate to ±5 and multiplies by 0.7. Material
advantages greater than five therefore share the same display boundary. Turn,
castling rights, en-passant state, move history and most positional structure
are absent from the embedding. Different positions can have identical points;
nearby points need not have similar legal continuations or game outcomes.

Call it a **three-feature map** or **position-feature space**. Keep raw values
available and mark clipped coordinates. Its axes have different authored scales,
so Euclidean distance is a chosen similarity heuristic, not a physical metric.
Select a point to recover its board, FEN and ply. If “velocity” is exposed, state
the sampling interval: the baseline samples every fourth ply, not equal seconds.

One existing king-safety detail also deserves a deliberate fixture: at a/h files,
clamping adjacent file indices duplicates the edge file. That double-counts a
shield location. Changing this should update both implementations and their
expected answers rather than be hidden as a visual adjustment.

### F07 — P2: an eval bar is not a calibrated probability

The baseline board bar maps clipped centipawns linearly, and panel/board graphs
clip to their declared ranges. Those mappings are useful visual encodings if
their limits and white-positive convention are visible. They must not be
presented as a probability or literal number of extra pawns on the board.

Stockfish's documentation describes normalized evaluation and an optional WDL
model. Actual WDL values need their engine option, model/version and context;
they cannot be recovered from this project's arbitrary linear display bar.
Mate should retain its typed value rather than become an ordinary extreme
centipawn point. Show depth/nodes and whether the value is an engine result,
bound, material proxy or unavailable.

Primary references: [Stockfish evaluation FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html)
and [official WDL model](https://github.com/official-stockfish/WDL_model).

### F08 — P2: runtime X3D needs its own conformance and picking contract

`tools/validate.sh` checks the two retained scene files. It does not validate the
runtime piece, FX, heatmap, graph, phase-space or particle fragments. Its copied
XSD also uses a local XML-signature import stub. Record that adapted instrument
instead of describing it as an untouched external validator.

Runtime Shapes use `pointerEvents='false'` to let the board TouchSensor receive
clicks. X_ITE documents that Shape field as a nonstandard extension. This is a
reasonable implementation choice for the selected browser, but a portable X3D
export needs an explicit projection or alternative picking structure. Add
profile/component and runtime-fragment checks; schema legality, actual loading,
picking and visible output are separate gates.

The named-node boundary is valuable. X_ITE specifies that missing named nodes
throw, so configuration and readiness checks should fail clearly before scene
construction. Use documented Promise-based loading and world replacement
instead of assuming an optional undocumented readiness property has waited.

Primary references: [X_ITE Shape](https://create3000.github.io/x_ite/components/shape/shape/),
[scene services](https://create3000.github.io/x_ite/reference/scene-services/),
and [X3D 4 Shape specification](https://www.web3d.org/documents/specifications/19775-1/V4.0/Part01/components/shape.html).

### F09 — P2: measure the combined spectator workload

The baseline recreates piece geometry/materials on a theme switch, uses many
primitive Shapes per piece and reparses fragment strings for updates. This is
clear code at the present scale, but geometry/material reuse and updating
existing fields are sensible next measurements. DEF/USE or PROTO reuse does
not by itself guarantee GPU instancing; measure the browser implementation.

Test 1, 4 and 20 boards with the same engine budget, heatmap on/off, normal and
reduced motion, and focused/overview cameras. Record frame-time percentiles,
parse/commit time, memory, live node counts and engine queue age. Separate engine
throughput from rendering: an engine pool and a software-rendered view compete
for CPU in some environments. A faster GPU does not establish a Stockfish speedup.

Existing SwiftShader numbers are scoped observations, not universal hardware
floors. A count of correctly positioned pieces does not establish frame rate,
readable labels, pixel parity or successful picking in another camera/layout.

## An X3D chess observatory with explanatory power

The strongest additions are relationships and comparisons that benefit from
space. Keep the familiar flat board legible; assign height to a meaning, with a
legend, rather than lifting every piece according to an unrelated score.

### 1. A selected-position Lens

Use the spectator's focused board as a stable laboratory. Separate exact legal
moves, geometric attacks and conditional x-rays into selectable layers. A
pinned piece can have an attack relation while its king-safety restriction
removes moves. A blocker can make an apparent discovery fail. This provides
small, inspectable counterexamples with exact rule-library answers.

A particularly visual example was freshly checked using the vendored chess.js:

```text
k7/8/8/r4pPK/8/8/8/8 w - f6 0 1
```

White is not in check. The legal UCIs are `g5g6`, `h5g6`, `h5h6`, `h5h4`.
The apparent en-passant capture `g5f6` is illegal: removing both pawns opens the
rook's a5–h5 line to the white king. Ghost the two removed occupancies, then
reveal the opened ray. Retain the original input FEN; chess.js normalizes away
an en-passant field that produces no legal capture when serializing by default.
This is a legal-move counterexample, not an engine-strength claim.

### 2. Paired counterfactual boards

Show two deliberately chosen valid positions with one controlled difference:
a blocker, a castling right, side to move or a legal en-passant opportunity.
Reveal which legal moves change. Never assume flipping the FEN turn creates a
valid position, and do not claim a forced win without the relevant search or
tablebase witness. Pairing positions with the same three-feature point makes
the limitations of feature-space compression visible.

### 3. A search observatory

Let a small number of verified principal variations rise as labeled candidate
branches from the focused board. Every branch starts from a named position;
replay each UCI move legally before drawing it. Depth, budget and bound flags
travel with each branch. A search PV is a selected engine continuation, not an
exhaustive tree or a proof that all alternatives fail. MultiPV should share a
bounded resource policy with the live tournament.

### 4. A controlled tournament laboratory

Use paired openings and swapped colors to compare engine settings. Preserve
seed, opening line, engine build/options, stopping rule and complete outcomes.
Small samples should show uncertainty rather than a confident strength ranking.
This connects naturally to the public mathematics lessons on probability,
inference and conditioning, while chess remains the actual experiment.

## The reusable learning unit

Carry a small case with: input state and history scope; question; exact rules
or search procedure; expected relation; observed result; display mapping;
negative control; source and software identities. A colored line should answer
“which relation, on which position, according to what instrument?”

| Entity | Useful fields |
|---|---|
| Game episode | ID, initial FEN, opening moves, seed, engine configuration |
| Position record | Episode, ply, raw input/state FEN, predecessor move, history scope |
| Analysis observation | Subject position, score perspective/type, depth/nodes, algorithm/version, outcome |
| Tactical relation | Source/target squares, relation class, legal or geometric status, witness and caveat |
| Visual mapping | Coordinates, layer, color legend, clipping, camera and animation setting |
| Verification | Exact input/output identities, comparison, tolerance where applicable, negative control |

These are ontology hooks, not a demand for a new universal protocol. Reuse the
existing event contract and add versioned fields only where a consumer needs
them. A legal-state hash, a render snapshot hash and a history identity answer
different questions. FEN alone is not the entire provenance of a game.

## Acceptance ladder and next priorities

1. **State:** known legal/illegal positions and special moves; exact result,
   history and score semantics.
2. **Ordering:** delayed old events, reconnect snapshots, stopped searches and
   same-board concurrent visual updates.
3. **Representation:** algebraic square → world position, placement, promotion,
   castling and en-passant removals; no stale overlays after resets.
4. **X3D:** actual generated fragments, profile/extension declarations, named
   contracts and a portable snapshot projection.
5. **Experience:** actual board picking, focus, keyboard behavior, reduced motion,
   legends and error display.
6. **Scale:** reproducible workload measurements and explicit device/runtime
   context; no inferred universal speedup.

Prioritize layout/state correctness and truthful analysis, then the small Lens
cases and visual clarity. Optimize repeated geometry/fragment creation after
measurement. Search branching, tournament inference and additional renderers
should consume the same verified position records. This lets every creative
feature add another way to understand a position while preserving a concrete
way to detect a wrong explanation.

## Source and evidence register

Local baseline evidence: `README.md`; `docs/RESULTS.md`, `ARCHITECTURE.md`,
`PROTOCOL.md`, `X3D-MAPPING.md`; `tools/gen_grid.py`, `smoke.mjs`, `validate.sh`;
`viewer/js/scene.js`, `board.js`, `camera.js`, `panel.js`, `analysis.js`,
`overlays.js`, `phasespace.js`, `fx.js`, `pieces.js`, `particles.js`, `main.js`;
and Python `analysis/phase_space.py`. The two fresh checks described above used
the retained XML and vendored chess.js, respectively.

Primary web references were checked on 17 November 2026. Current documentation
describes APIs and rules; it is not fresh execution evidence for this project.
Exact runtime/library pins and final results belong in the release's own records.
