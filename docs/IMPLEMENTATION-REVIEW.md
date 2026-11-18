# Implemented review and evidence boundaries

Baseline: `dea017f6b4e13abdbbe11553aeac131a3d80704d`.
The baseline assessment remains in [CHESS-REVIEW.md](CHESS-REVIEW.md).
This companion describes the resulting extension rather than repeating findings
as though they were still all open.

## Disposition

| Finding | Implemented response | Remaining acceptance or expansion |
| --- | --- | --- |
| F01: board/layout disagreement | One runtime layout generates PROTO instances, origins and cameras for 1–64 boards; SAI-adapter placement controls cover partial and maximum grids. | Native camera/picking checks at each representative count; measured performance budget. |
| F02: async fragment races | Recovered piece/effect queues; single-flight overlays; revision/epoch commit checks; complete settled barriers. | Browser fault injection and long-running memory/node-count trials. |
| F03: stale visual claims | Snapshots clear rendered graphs, phase trails, cues and study overlays. Game generations and monotone sequences reject stale writes. Empty tactics clear the panel. | Native reconnect/reset stress under live Workers and SSE. |
| F04: inherited incorrect analysis | Correct absolute pins and legal discovery witnesses; no fake overloads; neutral swing labels; independent answers plus regenerated, producer-bound Python/JS parity. | Candidate forks/skewers still need search/refutation for stronger tactical claims. |
| F05: attack-count semantics | Explicit attack-balance naming and guide; pinned-attack experiment gives a concrete counterexample to legal-mobility interpretation. | Hover/keyboard square inspector and persistent numeric legend per square. |
| F06: feature-map meaning | Clipping, authored scales and many-to-one mapping explained; edge-file king-shield double counting repaired. | Native axis labels, raw values and selected-point board recovery. |
| F07: evaluation meaning | Exact pre-move FEN/ply, score kind/bound, typed mate and null preserved; score-source label; graph gaps and unavailable bar; no probability or blunder claim. | Equal-budget candidate comparisons, engine-version/search-settings observation schema and optional measured WDL. |
| F08: runtime conformance | Actual XML writers captured; full pinned XSD/semantic checks; real XML-signature schema; negative controls; explicit picking-field portability projection. | Native load/picking acceptance and additional importer-specific semantic checks. |
| F09: combined workload | Source identities and layered evidence establish a measurable baseline; no inherited hardware-floor claim retained. | Fresh frame-time/queue-age/memory trials; geometry reuse only after profiling. |

Additional defects repaired outside that list include UCI waiter/send races,
pending-work cancellation, failed engine leases, initial-SSE ordering, slow
clients, legal opening books, move legality and completed-state reconnects.
See [server](SERVER-REVIEW.md), [analysis](ANALYSIS-FIDELITY.md),
[renderer](RENDERER-CONTRACT.md) and [transport](../tools/transport-review.md).

## Educational extension

The study room adds four bounded experiments grounded in the
[FIDE Laws](https://handbook.fide.com/chapter/e012023): pinned attacks, en passant
rank exposure, promotion/terminal outcomes and castling transit. The catalog has
seven source positions and sixteen explicit probe rows, with complete saved
legal move sets and terminal predicates. The generator checks independent
manual expectations before recording Python witnesses. Chess.js verifies those
witnesses at test time and in the browser.

This is a rule laboratory, not a ranked puzzle solver. The rook-promotion
variant establishes an available continuation rather than a forced win.
Geometric relation links do not trace legal piece movement. The game-action
count is zero after a terminal study outcome; the saved witness deliberately
retains the rules library's king-safe move-generator output for independent
comparison, including in insufficient-material positions.

The raw en passant FEN is retained beside the library's canonical FEN. The
input's `f6` target can normalize to `-` when the capture is illegal. That is a
useful provenance distinction, not evidence that the source history disappeared
from the experiment. Neither FEN representation contains a full repetition
history.

## Export and Blender result

The owned static exporter writes X3D 4.0, explicit Text level 1, named pieces,
square labels, selected appearance and optional study relations. Its default
palette is deterministic rather than inherited from another scene's global
state. Literal metadata is XML-escaped without interpreting backslashes.
`Shape.pointerEvents` is omitted with a loss record because X_ITE documents it
as a nonstandard field. No generic untrusted-X3D sanitizer is claimed.

The actual Blender 5.2.4 import of the en passant position was rendered with
the public importer revision named in
[blender-preview.json](../evidence/blender-preview.json). All five imported
piece centers/base heights agree within the recorded tolerance. The preview
uses authored studio lighting/material adjustments and a bevel on the actual
imported relation curve. Its coordinate-label glyphs appear as outlined boxes;
typography fidelity remains open. Occupancy success does not establish topology,
material, font, camera or annotation equivalence.

## Evidence hierarchy

| Gate | Executed instrument | Establishes |
| --- | --- | --- |
| Rule meaning | Manual known answers, python-chess, independent chess.js, defective twins | Outcomes for the bounded corpus; not complete correctness for every chess position. |
| Transport/state | Deterministic async controls, Python reliability tests, real vendored WASM UCI | Ordering/lifecycle cases and actual engine searches; not native Worker startup. |
| Renderer orchestration | Real viewer modules with a deliberately small SAI adapter | Layout and async commit contracts; not native X_ITE implementation behavior. |
| X3D structure | Captured writers, pinned full schemas and implemented semantic checks | Accepted documents and detected defects; not visible fidelity or every specification rule. |
| Import occupancy | Actual Blender importer and measured world-space geometry | The five tested piece positions under the declared axis conversion. |
| Native browser | Independent smoke tool; current environment launch blocked | `not_run`; no new browser pixels, GPU timing or picking claim. |

`npm test` produces the aggregate source-bound receipt. Each local receipt is
unsigned. Hashes establish identity and staleness detection within this workflow;
they do not authenticate a publisher, provide a formal Loom acceptance receipt,
or prove that an unexecuted gate passed.

## Reusable learnings

1. Keep state, inference and view separate, then retain the relation between
   them. Pre-move search identity is as important as a result's number.
2. Define the question before choosing the visual primitive. An attack ray,
   a legal transition and an engine principal variation carry different claims.
3. Pair each striking example with a nearby intervention. The source of an
   “aha” is often a changed constraint, not a larger animation.
4. Save raw input and canonical input separately when normalization matters.
5. Use broad parity to find drift and independent answers to find shared errors.
6. A visual artifact needs staged evidence: schema, model, importer and pixels.
7. Record semantic loss at each export boundary. A beautiful render can still
   reveal a broken font path or an omitted interaction rule.
8. Treat cancellation, disposal and new-generation resets as semantic events:
   a stale annotation is an incorrect explanation even when its geometry is valid.

The [integration atlas](INTEGRATION-ATLAS.md) and
[ontology hooks](ONTOLOGY.json) turn these lessons into bounded follow-up work.
