# Chess Observatory: integration atlas and next research steps

This atlas joins the baseline review to the implementation in this pass. Its
source baseline is `dea017f6b4e13abdbbe11553aeac131a3d80704d`; current files are
the working-tree revision prepared for the accompanying patch. The final release
receipt identifies the exact checked bytes. This is a public-safe project
document: it contains no private corpus, private storage map or private workflow
material.

The useful common unit is a **position, a question and a scoped witness**. Chess
can supply exceptionally clear examples of the same distinction used in the
mathematics and STEM projects: the model, an analysis of the model, and a picture
of that analysis each answer a different question.

## What this pass has implemented

| Baseline concern | Current implementation | Boundary still to retain |
|---|---|---|
| Requested board count differed from the static grid | `layout.js` builds one requested layout; `scene.js` uses it for board instances, piece origins and cameras | Structural support for 1–64 boards is not a frame-rate guarantee |
| Async heat/graph creation and rejected queues | `board.js` shares initialization work, guards generations/revisions, recovers queues and clears actual overlay geometry on reset | Actual native-browser scheduling still needs its own execution evidence |
| Stale events after a new game | `renderer-state.js` and transports track generation, sequence and ply; snapshots invalidate older visual work | Legacy streams without those fields have weaker guarantees |
| Incorrect inherited tactic labels | `analysis.js` and Python analysis now use bounded geometric candidates, actual pin rays and legal discovery witnesses | Candidate geometry does not prove a safe capture, best move or material win |
| Absolute score changes labeled as blunders | Neutral swing labels bind comparable samples to their scored FEN/ply; mate and nonexact bounds leave the numeric window | Move-quality comparison against searched alternatives is deferred |
| Search score attached to the resulting board | `eval_fen`, `eval_ply`, evaluation kind and score bounds identify the searched position separately from the post-move `fen` | An evaluation is search-dependent and is not a probability |
| False outcomes and failing engine reuse | Server and browser pools retire failed leases, validate replies and preserve an unchanged board on recoverable failure | Native Windows processes and actual browser Worker startup remain separate targets |
| Draw/history ambiguity | The live server uses explicit claim adjudication and separately labels the ply cap; browser search histories retain legal opening moves | A FEN snapshot does not supply complete repetition history |
| Study only as a future idea | `study.js` supplies four deterministic rule experiments with seven source variants and independent library checks | It is a rule study, not engine search or arbitrary best-move coaching |
| Runtime X3D outside the old gate | Actual runtime writers and portable study exports are captured and checked with pinned XSD/semantic tooling | The X_ITE picking extension is removed as a documented export projection |
| CDN dependency and opaque environment | The pinned X_ITE subset and dependency identities are local; runtime/engine receipts name their sources | Newly added components need an updated local asset inventory |
| Export without an independent visual consumer | A portable en-passant study was imported through a pinned X3D importer into Blender 5.2.4 LTS; actual mesh centers/base heights for its five pieces passed a bounded occupancy check | This authored offline still does not establish native X_ITE rendering, full annotation/material fidelity or two-way round trip; imported typography remains imperfect |

These entries describe code and the module-level records available in
[analysis fidelity](ANALYSIS-FIDELITY.md), [renderer contract](RENDERER-CONTRACT.md),
[server review](SERVER-REVIEW.md), [runtime validation](RUNTIME-VALIDATION.md)
and [transport review](../tools/transport-review.md). The root release check
should decide the final aggregate pass status. The historical `RESULTS.md`
remains evidence for the older port, not this revision's native pixels.

The new native-browser record is explicitly `not_run`: this host cannot launch
the required Chromium socket operations. Real WASM/UCI execution through Node,
SAI-adapter controls and schema checks establish useful narrower properties.
They do not substitute for fresh X_ITE screenshots, browser Workers or GPU
performance.

Draw adjudication is deliberately policy-specific: browser WASM/replay uses
`claim_current_position`, while the Python server uses `claim_available`, which
can also recognize a legal intended next move that enables a claim. Both retain
shared claim/mandatory-ending reason names; they do not claim competitive draw
procedure parity. The browser replay cap remains `replay_cap`, distinct from
engine `ply_cap` adjudication.

## The four studies form a small curriculum

| Study | Question made visible | Exact distinction | Useful connection |
|---|---|---|---|
| Pinned is not powerless | Can the king enter a square attacked by a pinned knight? | Attack relation versus legal move | Constraints and admissible directions |
| En-passant ray | Why can removing two pawns make an apparent capture illegal? | Destination alone versus complete occupancy transition | Nonlocal consequences and invariant preservation |
| Castling transit | Why does the king's route matter even when its destination is safe? | Endpoint test versus path constraints | Feasible paths and boundary conditions |
| Underpromotion | Why can choosing less material avoid stalemate? | Material heuristic versus legal terminal state | Objectives, proxies and counterexamples |

The studies preserve the raw source FEN, normalized rules-library FEN, complete
legal-move sets for the saved controls and the result of each selected probe.
The Python producer and chess.js consumer disagreeing should stop the study;
the application should not hide the disagreement behind an animation. Terminal game outcomes stop further Study game actions, while the saved raw
move-generator witness retains its separate rule-query meaning. Async reset and
stop invalidate earlier highlighted work. After a
learner moves, the page identifies the current position as a new state rather
than continue presenting the original annotation as its proof.

The relation arcs are authored explanations. They are not trajectories that a
knight physically follows, nor do they turn a geometric tactic candidate into
a forced win. Color should encode one named relationship at a time. Keep the
legend beside the picture and let the exact rule record be inspected.

## Taxonomy: classify by object, activity and acceptance question

| Axis | Classes | Why it matters |
|---|---|---|
| Chess object | Episode, position, legal move, attack relation, history, opening prefix, search line | A position's occupancy is not its entire game history |
| Analysis record | Rule witness, geometric candidate, engine score, score bound, feature vector, adjudication | These cannot share an unlabeled numeric score or confidence grade |
| Representation | FEN, UCI/SAN history, PGN, JSON observation, X3D snapshot, live scene, raster view | Every conversion preserves a different subset |
| Activity | Move transition, engine search, rule evaluation, event acceptance, visual commit, export, validation, render | An operation completing does not establish every downstream property |
| Evidence | Source inspection, known-answer control, cross-language parity, actual engine run, actual browser run, device measurement | Parity is agreement; an independent expected answer gives it meaning |
| Acceptance facet | Legality, event ordering, occupancy, analysis semantics, visibility, interaction, readability, resources, provenance | A schema pass cannot certify chess truth or pixel quality |
| Readiness | Implemented, locally checked, awaiting native execution, proposed, blocked by missing inputs | Prevents a future feature from appearing as a current capability |

`ONTOLOGY.json` is a machine-readable vocabulary and work register for these
distinctions. It maps artifacts and observations to PROV entities, searches and
verification runs to activities, and categories to SKOS concepts. It is an
ontology hook document, not a running reasoner, a formal event schema, or an
external certification profile.

## Identity rules for integration

**Episode.** Use `game_id` together with `generation`. A new game on `g0` is a
new episode, not a backwards move of the previous game. The event sequence is
an ordering aid, not a chess position identity.

**Position.** Preserve episode, ply, FEN and history scope. Castling rights,
side to move, en-passant semantics and counters must not be discarded when a
consumer needs them. Keep raw input separately when normalization changes a
serialization. Repetition claims require retained history or another explicit
source, rather than a list of equal placement strings.

**Search.** Bind the engine build/options, searched FEN/ply, available move
history, budget and score perspective. Keep `engine_cp`, `engine_mate`,
`material_proxy` and `unavailable` distinct. A lower/upper bound is not an exact
sample. Identical configuration does not imply identical wall time, especially
under concurrent workloads.

**Figure/export.** State whether it captures model occupancy, current animation
pose or the whole live application. The portable position exporter deliberately
uses model occupancy and authored appearance. Its metadata does not serialize
engine workers, clock state, complete history or the full live tournament. The exporter has a
deterministic classic palette default; the UI explicitly passes the selected
palette. An unavailable score now clears the live bar and piece tint rather than
retaining an earlier numerical claim.
Removing `Shape.pointerEvents` is a declared portability projection, not a
silent claim that all interaction is portable.

**Hash.** A byte hash names an artifact. It does not establish legal chess,
publisher authentication or correctness. If a future semantic position hash
normalizes fields, name that normalization separately. Do not interchange it
with a file hash or history identity merely because all are hexadecimal strings.

## Cross-project foldback

| Project | Reusable contribution from chess | What chess can consume | Bounded handoff |
|---|---|---|---|
| MathLab | Counterexamples where a plausible heuristic loses to an exact constraint; prediction/probe/explanation loop | Existing educational patterns for inference, geometry and conditioning | One lesson card per rule study, linking its current witness and source |
| STEM / Research Loom | Episodes, searched-position identity, bounded event acceptance and nonlocal occupancy changes | Raw-versus-display contracts, independent numerical witnesses and explicit projections | A shared explanation of source state → derived relation → visual mapping, without copying domain kernels |
| x3d.docs | Small SAI races, named-node contracts, pointer-extension projection and runtime component failures | Technical drills, source-bound findings and acceptance vocabulary | A public synthetic fixture plus paired passing/failing control for each concept |
| x3d.demos | A polished spectator and a compact Study room with a clear question | Versioned discovery and publication discipline | A discovery card only after the intended live destination is verified |
| x3d.ml | Position/analysis/figure records suitable for task datasets; known wrong explanations with exact controls | Dataset identity, provenance adapters and disciplined evaluation methods | Export a public-safe study subset with an explicit schema and split; do not claim model performance |
| Flywheel / agent work | Failure classes that become fixtures: stale state, wrong score subject, misleading motif, extension loss | Pure command wrappers, typed evidence and reuse across tools | Keep the existing scorekeeper; contribute observations and fixtures rather than another global scalar |

The common interface should be small. A learning card need not import the live
engine manager. A scientific study should not acquire chess-specific rule code.
A documentation drill can use a single delayed fragment without starting twenty
engines. Each owning project should retain its numerical, pedagogical, rendering
or orchestration responsibility.

## Remaining work, with acceptance evidence

### P0 — C01: native execution on an unrestricted host

Run the pinned local browser runtime through actual replay, WASM and Study modes.
Include 1, 20 and 64 requested boards, a partial-row layout, real mouse picking,
theme changes, reduced motion and study reset/undo. Record page and dependency
hashes, camera/layout, browser/graphics backend, screenshots, console findings
and exact assertions. WASM Worker initialization must run in the browser; Node
UCI execution cannot close that part. Acceptance is a scoped pass/fail record,
not a screenshot without state identity.

### P1 — C02: target-device workload measurements

After C01, measure frame-time percentiles, memory, live nodes, scene parse/commit
time, engine search throughput and queue age. Compare heatmap on/off at a fixed
engine budget. A target such as 16.7 ms per frame is an engineering budget, not
an achieved universal result. Keep device, runtime and workload beside every
number. Optimize repeated geometry/materials only after locating the cost.

### P1 — C03: interactive relation inspection

Extend the curated Lens into a selected-square inspector. Show the actual
attackers, legal destinations and pin ray with explicit relation types. Add a
promotion chooser before supporting arbitrary user moves. Acceptance needs
positive/negative controls for pinned attacks, double check, en-passant exposure
and promotion. Every displayed relation must refer to the current episode/FEN;
switching positions must invalidate delayed highlights.

### P1 — C04: semantic export round trip

Read a portable exported position independently and compare named piece types,
colors, algebraic squares, side to move and retained metadata to the source.
The current Blender receipt starts this work: it checks the actual imported
mesh centers and base heights of five pieces in one en-passant study. Extend
that narrow import check to the remaining piece/special-move fixtures and an
export/reimport route, rather than treating one still as complete round trip.
Keep the existing XSD/semantic check as a separate gate. Add castling,
en-passant, promotion and an intentionally moved XML piece. Reimporting a scene
that still contains its original metadata must not conceal changed geometry.
Whole-application import/export remains outside the static snapshot contract.

### P1 — C05: bounded PGN replay

Accept a bounded game or selected line, retaining `SetUp`/FEN context, comments
and source identity where supported. Verify every move legally, support stepping
and undo, and handle promotions and black-to-move starts. Treat comments as text,
not HTML or commands. This is a replay/study feature; it does not imply that
engine evaluations were recomputed for the imported game.

### P2 — C06: feature-space collision studies

Choose two valid positions with equal or near-equal authored feature vectors
but different legal moves or terminal status. Expose raw feature values,
normalization and clipping. Link the point back to its board and ply. Do not
assert forced outcomes without a search/tablebase witness. This gives the
abstract feature plot a concrete lesson about information loss.

### P2 — C07: verified search branches

Support a small MultiPV budget for a focused position. Bind each result to its
actual searched position, engine/options and depth/nodes/time. Replay every UCI
continuation legally before drawing a branch; reject an intentionally corrupted
PV and a delayed result for another position. The branches are selected search
continuations, not an exhaustive move tree or proof that alternatives lose.

### P2 — C08: controlled tournament comparisons

Define a reproducible opening selector, color-swapped pairs, stopping policy
and sample-size/uncertainty report before comparing settings. Keep losses,
draws, adjudications and failed searches separate. A small run can demonstrate
the experiment without supporting a strong rating conclusion. Model or engine
strength needs its own evaluation protocol, beyond move legality.

### P2 — C09: durable episode replay and resumption

The current snapshot/reconnect path resynchronizes present state. A durable
replay ledger is a separate feature. Record accepted episode events with their
history identities, then test process interruption, reconnect and resumed
consumption. Verify no duplicate moves and no old-generation visual commits.
Do not call in-memory state a crash-resumable checkpoint.

### P2 — C10: visual regression and accessibility

Use known scene/camera states and deterministic masks or occupancy readback
before relying on image similarity. Add fresh label/contrast/picking checks,
noncolor cues, reduced-motion behavior and input-focus keyboard tests. An ID
mask can prove that an expected object is visible at a tested view; it cannot
prove that a tactical explanation is true. Per-theme quantitative attack-map
legends and raw/clipped feature readouts remain useful refinements.

### P2 — C11: formal observation schema and graph adapter

The supplied vocabulary is a hook, not an implemented validator. Define a JSON
schema for exported observations and a read-only graph adapter with explicit
subject, facet, scope and artifact identities. Test wrong-FEN scores, unrelated
render evidence, future/unrun records and changed artifact bytes. Use a local
relation for evidence-record reproduction; activity-to-activity PROV relations
must connect actual runs, not their JSON files.

### P3 — C12: additional renderers and richer pieces

Keep the verified game/event model when adding glTF pieces, Babylon effects or
another X3D consumer. Choose a small piece set with explicit source attribution,
measure node/draw/parse costs and compare the same special-move fixtures.
Declare expected interaction/material projections per route. A more elaborate
mesh must not replace legible squares, legal-move semantics or the existing
engine resource bounds.

## Heuristics that should travel with the patch

1. **Make the subject explicit.** A pre-move engine score and a post-move board
   are related records, not the same position.
2. **Use the strongest available simple witness.** Exact legality is a better
   check of a legal-move arrow than an image judge's impression.
3. **Preserve disagreement.** A rules-library mismatch or a stale event is a
   useful failure result; do not smooth it away with an animation.
4. **Name the proxy.** Material, geometric control, shelter and normalized engine
   score are different quantities. None is a generic win probability.
5. **Show the counterexample.** A safe endpoint can have an unsafe castling
   transit; a pinned knight can still attack a king's destination.
6. **Reset the picture with the episode.** Empty arrays do not clear rendered
   coordinates. Clear the actual visual claim as well as its backing data.
7. **Keep resource policy separate from performance.** A 64-board limit is a
   supported configuration bound, not a device benchmark.
8. **Export a declared projection.** Model occupancy, animation pose and a full
   live application are different products.
9. **Let parity follow meaning.** Establish known answers before regenerating
   cross-language fixtures; two equal mistakes are still mistakes.
10. **Use 3D for relationships and comparisons.** Give height, color and motion
    a stated meaning; preserve a legible chessboard as the reference plane.

## Source map and evidence policy

Implemented boundaries are described by `viewer/js/{layout,renderer-state,board,
scene,analysis,study,export,panel,config}.js`, the three transport implementations,
`server/x3dchess_server/`, `tools/build_studies.py`, the runtime/export tests and
their companion documents. `evidence/study-build.json`, `runtime-check.json`,
`runtime-fragments.json`, `x3d-validation.json` and `browser-smoke.json` state
their own instruments and limits. Final aggregate validation belongs to the
root release record; this atlas does not silently upgrade every layer from one
successful check.

`evidence/blender-preview.json` separately binds the actual Blender binary,
importer commit/source, imported X3D, occupancy comparisons and authored CPU
render. It records its studio appearance changes and text/annotation limits.

Primary conceptual sources: [FIDE Laws](https://handbook.fide.com/chapter/e012023),
[Stockfish evaluation documentation](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html),
[X_ITE browser services](https://create3000.github.io/x_ite/reference/browser-services/)
and [PROV-O](https://www.w3.org/TR/prov-o/), with
[SKOS](https://www.w3.org/TR/skos-reference/) for classification hooks.
A standard or API reference explains
the intended contract; a local executed result shows what this revision did.
