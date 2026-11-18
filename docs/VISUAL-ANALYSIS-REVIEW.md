# A richer instrument for seeing chess

Review baseline: `66b9d5d6fd0f0ef18bf4d9a7ef106154d9fc9700`.
Review date: 17 November 2026, America/New_York.

The strongest direction for x3d.chess is a legible tournament observatory with
an optional, much denser position laboratory. Its advantage is the relationship
between an actual X3D position, exact rule queries, and inspectable search
observations. More simultaneous decoration would obscure that advantage. Give
each audience a useful amount of information, and let a selected square or
position reveal the next layer.

This review combines inspection of the current repository with a direct visit
to the published application. The cloud browser displayed the application shell
but reported a failure to create its WebGL context. That observation limits what
this browser established about rendering; it does not establish that the public
site fails on the user's computer. The local implementation and its separate
headless-browser checks are described below. Historical measurements in
`RESULTS.md` remain historical and should not be reused as performance results
for these changes.

## Critical findings and implemented responses

| Finding at the reviewed baseline | Response in this patch | Remaining limit |
| --- | --- | --- |
| Advanced features existed, but information was dispersed among short overlays and a small floating panel. | An optional Analyst desk separates Position, Structure, Control, and Search. | Dense views still need usability trials with different chess skill levels. |
| Color and height could show pressure without supplying the underlying counts beside the board. | A numeric 64-square control matrix exposes both colors' attackers and selects the matching X3D square. | Attack counts remain geometric relations, not exchange analysis. |
| Primitive pieces were serviceable in overview but weakly distinguished in close views. | Authored turned bodies, recognizable crowns, a mitre opening, and an extruded horse head improve silhouettes. | Native appearance depends on camera, lighting, display, and runtime. |
| An opponent piece's inspector summary could say “0 legal moves.” | It now says that legal destinations are unavailable because it is the other side's turn. | Other-turn queries must continue to be labeled as projections. |
| A held game could leave transport shutdown awaiting an unresolved hold. | Every halt releases holds after invalidating the run; pending moves cannot commit. | Search cancellation and resource policy remain separate concerns. |
| Late engine results could outlive their focused-board interaction. | Request identity, held game, selected board, generation, and searched FEN guard acceptance. | Repetition-dependent search still needs the appropriate retained history. |
| The legacy graph compressed missing observations and accepted mate proxies as ordinary centipawns. | Typed graph samples retain gaps and break at mates, bounds, and score-source changes. | Graphs are search observations, not calibrated outcome probabilities. |

## What the installed upgrade gives the viewer

The Spectator view retains the broad scene. Choosing Analyst opens a dedicated
column instead of adding another large surface over the board. The detail choice
is reflected in the URL. On narrower screens the desk flows below the scene;
Study mode keeps its experiment controls and uses the same optional desk.

**Position** presents material balance, a piece inventory, legal move choices,
mobility categories, king-ring pressure, and score provenance. The score's source
FEN is available separately from the displayed FEN. This matters in live play:
the most recently reported score often describes the position before the move
that is now visible. A plausible number attached to the wrong position is a
misleading explanation.

**Structure** turns pawn topology into concrete lists: passed pawns, isolated
pawns, doubled files, and the extra pawns on those files. File counts expose
open and semi-open relationships. The king-ring table shows attacked adjacent
squares and the number of enemy attack relations. These are inspectable
properties of the current occupancy, rather than verdicts that a king is unsafe
or a pawn must be weak.

**Control** provides an unsaturated numeric companion to the X3D heatmap and
terrain. A zero can mean no attacks or equal opposing counts; the selected
square reveals the actual sources. Arrow navigation, a visible selection, and
spoken square/count labels make color supplementary. Selecting a matrix square
also invokes the X3D inspector, joining exact text to the spatial explanation.

**Search** holds one game and requests a chosen number of MultiPV lines at a
chosen depth. Every accepted line is replayed legally before display. The desk
shows SAN, score kind and bound, depth, nodes, elapsed search time, and the
resulting FEN. Full lines remain inspectable beyond the shortened initial
display. The user explicitly releases the held game to continue play. Changing
focus invalidates the old interaction rather than allowing delayed results to
repopulate it.

The visual layer adds a restrained board frame and more sculpted X3D pieces,
shared by the live scene and static export. Their bases and bodies use bounded
16-sided turned profiles. Shape recognition carries the piece identity: rook
crenellations, queen crown, king cross, bishop mitre, and opposing knight
orientations. Oblique White, plan, and Black views support different questions.
Camera orientation uses quaternion interpolation so crossing to Black's side
does not interpolate unrelated axis-angle components.

The fresh lens screenshots also expose useful remaining polish: Moss makes
Black pieces quite dark, the extruded knight has a narrow front view, and long
simultaneous PVs can become a line tangle. A lifted dark-piece value, a fuller
knight volume and first-move/selected-line/ply-scrubber disclosure deserve the
next visual pass. These checks establish functioning views; they do not settle
perceptual quality for every position or viewing angle.

## Meaning must survive the attractive picture

The pure `position-report.js` module keeps chess facts outside the HTML and
renderer. Its material values are authored units, P1/N3/B3/R5/Q9. Its king ring
contains on-board neighboring squares, with current occupants retained. Its
attack map includes pinned attackers. None of those quantities is a substitute
for a searched evaluation or legal king destinations.

Mobility needs particular care. The side to move receives its actual legal
move-generator output. The other side receives a hypothetical turn projection
with castling and en-passant rights removed. That projection is unavailable
when the actual side is checked. Ordinary counts exclude those special moves
on both sides, while promotion choices count separately. These distinctions
make the comparison useful without inventing a legal sequence in which both
sides move from the same position.

The main game search can retain its legal move history; the focused MultiPV
analysis currently searches a FEN alone. A FEN omits complete repetition
history. Likewise, available legal moves do not necessarily mean that a drawn
game should continue. Keep game adjudication, move-generator output, geometric
relations, and engine preferences as separate records.

The branches also need a literal visual legend: arc links join successive
destination squares. They do not trace one piece moving through the entire
polyline. Their colors distinguish line rank; height distinguishes rank and
ply. Neither encodes evaluation. That clarification is now part of the visible
branch explanation.

## Creative extensions with a clear analytical purpose

| Priority | Proposed experience | Evidence needed before presenting its stronger claim |
| --- | --- | --- |
| P1 | **Counterfactual bench:** compare the actual move with two selected alternatives in synchronized small boards. | Legal transitions; identical engine build/options; explicit node or time budgets; exact searched positions and score perspectives. |
| P1 | **Exchange microscope:** step through captures and reveal newly opened rays after each removal. | A declared exchange algorithm and counterexamples involving pins, x-rays, promotion, and en passant. A count of defenders alone is insufficient. |
| P1 | **Opening divergence:** identify where games depart from a selected reference line, then compare resulting pawn structures. | Named opening source, bounded game sample, transposition-aware position matching, and a distinction between frequency and quality. |
| P2 | **Endgame chamber:** contrast attractive heuristics with exact tablebase outcomes on eligible positions. | Verified provider/data identity, supported piece count, rule assumptions, and explicit WDL/DTZ meanings. Missing coverage must remain missing. |
| P2 | **Search evolution:** animate how candidate ranks and evaluations change as the same search deepens. | Retained per-depth observations, fixed searched position, and careful separation of depth changes from independent searches. |
| P2 | **Feature collisions:** recover two different positions occupying the same authored feature-space point. | Exact underlying FENs and raw feature values. Visual proximity must not imply equal legal continuations. |
| P2 | **Tournament comparison:** pair openings and reverse colors to compare configured conditions. | Reproducible pairing, stopping policy, failure/adjudication counts, and uncertainty appropriate to the sample size. |

Engine WDL would be an interesting additional view only when the actual engine
is configured to supply it. Preserve the reported convention, search context,
and model identity. Do not synthesize win percentages from material or a
convenient centipawn-to-color curve. A three-way W/D/L strip can complement the
numeric score while keeping an explicit unavailable state.

For visual density, use synchronized small multiples before overlapping more
layers on the main board. A structure-only miniature can sit beside a current
position; an attack-only miniature can expose the sources hidden by pieces.
Ghost pieces should identify a specific alternative position and remain
visually distinct from current occupancy. Color, line style, labels, and a
clear time/position subject should agree.

## Rendering and performance roadmap

The new geometry is a fidelity investment, not a demonstrated speedup. A fresh
standard-starting-position generation produces approximately 266 KB of piece
XML for one board. It contains 92 piece Shapes, compared with 100 in the old
primitive set. The six additional frame Shapes bring that comparison to 98;
neither number includes all existing square and overlay Shapes. XML bytes,
triangles, node count, draw calls, parse time, and GPU cost are different
measurements. Fewer Shapes alone does not establish faster rendering.

The next optimization should give the focused board a larger budget. Use a
simple silhouette at overview scale, increase geometry when a board is selected,
and use hysteresis so small camera movements do not repeatedly replace meshes.
Keep transforms and chess identity stable across detail changes. An authored
LOD policy should preserve distinguishable piece types in every tier.

Consider shared Geometry with DEF/USE or cached per-piece templates after
profiling. Share immutable geometry while retaining independent transforms and
any independently changing appearance. A shared material can unintentionally
propagate a highlight to every instance. Measure whether the runtime actually
reduces parsing, allocation, or drawing; do not label DEF/USE as automatic GPU
instancing.

Terrain and concept toggles currently fan out across boards. Add a selectable
scope—focused board, visible boards, or all boards—and bound update cadence.
Refresh derived analysis when the accepted position changes, rather than on
every animation frame. Keep search depth/pool policy independently adjustable
so a more detailed display need not create a larger engine workload.

Measure fixed replay sequences at 1, 20, and 64 boards, a partial row, and the
focused Analyst view. Record browser, renderer, viewport, device pixel ratio,
theme, overlays, engine budget, and dependency revisions. Separate cold load,
warm steady state, and repeated theme/focus transitions. Capture frame-time
percentiles and long frames, fragment parse/commit time, node count, pending
work age, engine throughput, and available memory indicators. Repeat after
garbage collection opportunities and after extended use. Targets such as
16.7 ms per frame are budgets to investigate, not results achieved here.

## Validation and acceptance

The local checks exercise deterministic rule answers, asynchronous renderer
orchestration, held-game shutdown, generated mesh topology, camera rotations,
runtime XML, and actual Stockfish WASM searches. Independent Python controls
check the inspector corpus and engine continuations. Geometry checks cover
closed outward-wound shells, valid indices, nondegenerate faces, and bounded
coordinates; they do not establish attractive shading.

The final run passes 27 aggregate gates, including 35 Python tests in each of
normal and optimized modes. The Analyst browser run passes seven steps and the
existing lens run passes six, each without console/page errors; an additional
20-board replay smoke passes. The final aggregate is recorded in `evidence/integration-check.json`; it runs
all local suites, actual WASM controls, full X3D validation, and Python tests in
normal and optimized modes. `evidence/desk-smoke.json` separately records seven
browser acceptance steps: desktop layout, numeric control and square inspection,
cameras and palettes, 390-pixel layout, actual two-board WASM MultiPV, delayed
result rejection, and stopping a pending analysis. The delayed-result tests use
explicit synthetic scores; the earlier MultiPV step uses the actual engine.

These are local Chromium 153 / SwiftShader observations. They are distinct from
the cloud browser's failed context creation and from a target-device performance
trial. Source hashes and exact outcomes belong to the receipts. No device FPS
claim follows from these observations. Screenshots are generated test outputs
and can be reproduced with `node tools/desk-smoke.mjs`.

Export acceptance should also advance beyond schema validity. Independently
reconstruct piece type, color, and square from the exported geometry and compare
them with the source position. Exercise castling, en passant, promotion, and an
intentionally displaced piece. Retained metadata must not conceal changed
geometry. Compare camera, material, labels, and interaction as separate export
facets, recording losses explicitly.

## Foldback and practical heuristics

The durable contribution is a small pattern: source position → named relation →
visual encoding → inspectable witness. This can travel to MathLab, STEM,
Gobbler, and the wider Loom work without moving chess-specific kernels into a
shared framework.

1. Give every number a subject, unit, source, and display mapping.
2. Put an exact numeric view beside any saturated or clipped visual encoding.
3. Treat a missing value as a missing observation, not zero or compressed time.
4. Distinguish move choices, destination squares, attacks, and game actions.
5. Spend visual detail where a viewer is asking a question.
6. Pair an appealing heuristic with a small counterexample and an intervention.
7. Invalidate an explanation when its position or interaction ends.
8. Separate schema, rules, runtime pixels, and performance acceptance.
9. Record geometric/export losses rather than letting metadata imply fidelity.
10. Make the next optimization answer a measurement, not a shape-count slogan.

The requested GitHub foldback is prepared as a patch and PR material. Publishing
is currently blocked because the GitHub integration is disabled by the
administrator and the available CLI has no authenticated GitHub account. No
remote PR or deployment is claimed by this report.

## Primary references

- [FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023): attacks, legal transitions and game endings.
- [Stockfish terminology](https://official-stockfish.github.io/docs/stockfish-wiki/Terminology.html): principal variations, MultiPV and search concepts.
- [Stockfish UCI commands](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-%26-Commands.html): engine options and score/bound reporting.
- [chess.js API](https://jhlywa.github.io/chess.js/): the pinned implementation's move and attacker queries.
- [X_ITE browser services](https://create3000.github.io/x_ite/reference/browser-services/): runtime scene creation and SAI integration.

The repository code and executed receipts establish this patch's behavior; these
references establish the surrounding rules and API contracts.
