# Runtime provenance and validation

The checks distinguish legal chess, generated X3D, actual engine execution, and
native rendering. Passing one does not establish the others. Machine-readable
receipts are local, unsigned measurements bound to their input/tool hashes.

| Layer | Current evidence | Scope |
| --- | --- | --- |
| Browser dependencies | `viewer/vendor/x_ite/ORIGIN.json`; `viewer/vendor/DEPENDENCIES.json` | Exact bytes and origins; no execution inferred |
| Generated X3D | `evidence/x3d-validation.json` | 19 documents pass full XSD 4.0 and the pinned validator's implemented semantic checks; both paired negative controls caught |
| Writer coverage | `evidence/runtime-fragments.json` | Ten captures of actual XML writers, with producer hashes and portability losses |
| Real engine | `evidence/runtime-check.json` | Five controls execute the unchanged vendored Stockfish WebAssembly engine through Node UCI |
| Native X_ITE browser | `evidence/browser-smoke.json` | `not_run`: Chromium launch is blocked by this environment's socket policy |

The native result is deliberately incomplete. No new rendered screenshot, GPU
performance measurement, or browser Worker execution is claimed by the Node,
XML, or mocked SAI checks. Historical screenshots do not certify this revision.

## Aggregate reproduction

With Node and Python dependencies installed, run:

```bash
python3 -m pip install -r server/requirements-dev.txt -r tools/requirements-validation.txt
npm test
```

`CHESS_TEST_PYTHON` selects another Python executable. An inherited `PYTHONPATH`
can supply dependencies installed outside that executable's normal paths. The
driver adds `server/` to the import path and uses the unchanged vendored Node
engine for server engine tests. It fails when required dependencies are missing.

`tools/check.mjs` runs analysis, renderer, transport, study, panel, export, and
parity suites; captures runtime fragments; invokes the same full-schema adapter
as `tools/validate.sh`; executes the actual WASM engine both directly and through
the UCI pool; then runs all Python tests normally and with `-O`. A zero-exit
Python suite with skipped controls is rejected. Parity fixtures and study
catalogs are checked against their producer hashes, not silently regenerated.
Inherited pytest selection options/plugins and optimization settings are
cleared so the normal and `-O` runs execute the intended complete suites.

`evidence/integration-check.json` records exact command arguments, exit statuses,
output hashes and bounded output tails, child-receipt hashes, generated-input
checks, interpreter/dependency observations, and source inventories before and
after execution. Changes during a run fail its stability check. Evidence and
generated examples are excluded from the source inventory to avoid recursive
hashes; their actual content is bound through the child receipts. Native browser
execution remains a separate result. The aggregate labels an older browser
receipt as historical and records whether its tool hash still matches.

## Pinned browser assets

X_ITE **16.6.1** is retained from the version previously loaded by CDN. The local
entry point is `viewer/vendor/x_ite/x_ite.min.js`, with `x_ite.css` beside it.
The official [npm archive](https://registry.npmjs.org/x_ite/-/x_ite-16.6.1.tgz)
was checked against its SHA-512 npm integrity value. `ORIGIN.json` records that
value, the archive SHA-256, and all 66 retained file hashes.

This is an unmodified subset for the current scenes: core runtime, Text,
ParticleSystems and related optional components, fonts, icons, line textures,
and supporting library assets. It is not a complete distribution for arbitrary
new components. An additional scene dependency should be copied from the same
verified archive and added to the inventory before relying on it offline.
Package, distribution, font, and third-party licenses accompany the assets.

The existing chess.js and Stockfish loader/WASM/license files are byte-identical
to repository base commit `dea017f6b4e13abdbbe11553aeac131a3d80704d`.
`viewer/vendor/DEPENDENCIES.json` records the five file digests. The small
Stockfish `package.json` selects CommonJS for Node's Emscripten loader; browser
Workers do not consult it. The engine itself reports **Stockfish 19 Lite WASM**.

## Full local X3D validation

The adapter calls actual functions from
[`hagopjay/x3d_mcp`](https://github.com/hagopjay/x3d_mcp/tree/b5c9956917714747fe1d034c729612e99b0f09c9),
pinned to commit `b5c9956917714747fe1d034c729612e99b0f09c9`.
The self-contained `vendor/x3d_mcp/` subset preserves the full schemas,
including the actual XML-signature schema; it uses no substitute stub and
does not modify upstream code. Its origin manifest and every included source
are checked before use. The receipt records imported module origins, adapter
hash, schema hashes, Python/library versions, and input hashes.

The XSD version is **4.0**. Upstream semantic diagnostics use their default
**4.1** vocabulary, recorded separately rather than described as an XSD 4.1
result. The adapter has an explicit 8 MiB per-file input budget. Arbitrary
DTD/entity declarations are refused; the writer's fixed optional X3D DOCTYPE
is accepted. Validation uses local resources, with no network MCP call.

From the repository root:

```bash
python3 -m pip install -r tools/requirements-validation.txt
node tools/export-test.mjs
node tools/runtime-fragments.mjs
tools/validate.sh
```

The default 19 inputs are two static scenes, seven study-position exports, and
ten runtime-writer captures. Grid captures exercise 1, 20, and 64 boards. Raw
writer fragments are wrapped only when necessary. The portable projection
removes the documented X_ITE `Shape.pointerEvents` extension and records each
loss; it preserves unknown attributes so schema validation can reject them.
Synthetic effect/piece-bank fixtures carry explicit metadata and are not
represented as legal positions or physical simulations.

Two paired controls prove that the harness rejects a malformed numeric radius
at the XSD stage and a missing ROUTE source at the semantic stage while accepting
their matching positive controls. Capturing actual generated documents also
found defects that the original two static scenes could not expose:

| Writer defect | Why the XSD alone passed | Repair |
| --- | --- | --- |
| ParticleSystem declared ParticleSystems level 1 | Node syntax was valid; the component level was insufficient | Declare ParticleSystems level 2 |
| Phase-space Billboard omitted Navigation | Node syntax was valid; Interchange did not supply the required level | Add Navigation level 2 beside Text level 1 |

The original failing bytes and source digests are retained under
`evidence/before/`, with the measured verdicts in
`runtime-header-findings.json`. These intentional failures are outside the
default success set. To independently reproduce their failures, write a
separate receipt:

```bash
python3 tools/validate_x3d.py evidence/before/runtime-particles.x3d evidence/before/runtime-phase-space.x3d --output evidence/before/rechecked.json
```

That command should exit nonzero. Syntax and implemented semantic diagnostics
cannot establish chess/FEN fidelity, visual legibility, or native rendering.

## Actual WebAssembly engine controls

```bash
node tools/check-runtime.mjs
```

The tool verifies dependency hashes, starts the vendored WASM engine, performs
the UCI handshake, and checks:

1. Initial-position perft at depth 1 equals 20.
2. Initial-position perft at depth 2 equals 400.
3. A known mate-in-one returns a move that independent chess.js verifies is
   checkmate, with a mate-in-one engine score.
4. An already checkmated position returns no move.
5. A twelve-ply engine trace consists entirely of moves accepted by chess.js.

The trace runs isolated FEN searches with a fresh UCI game between searches.
It does not test repetition history, the browser Worker pool, rendering,
engine strength, or browser performance. The receipt records actual engine ID,
scores, FEN transitions, timing observations, tool hash, and binary hashes.

## Native browser reproduction

Install Playwright and its Chromium build on a host that permits browser
processes. The harness can also use `CHROMIUM_EXECUTABLE_PATH` or an existing
`/usr/bin/chromium`. It serves the viewer locally and uses the vendored runtime.

```bash
QUERY='?engine=replay&boards=1' node tools/smoke.mjs
QUERY='?engine=replay&boards=20' node tools/smoke.mjs
QUERY='?engine=replay&boards=64' node tools/smoke.mjs
QUERY='?engine=wasm&boards=20&depth=10&pool=3' node tools/smoke.mjs
QUERY='?engine=study&study=en-passant-ray' MIN_MOVES=0 node tools/smoke.mjs
```

Each successful run checks actual requested board count, board translations,
piece bounds, live child-node counts, misplaced pieces, actual move progress,
and browser errors. It waits for queued scene work and animations to settle,
then binds the screenshot hash to its receipt. `WAIT_MS`, `MIN_MOVES`, and
`SMOKE_RECEIPT` customize duration and output; use separate receipt/image paths
to retain multiple configurations. A browser that cannot start produces
`not_run` and a nonzero exit status. An initialized page that fails an assertion
produces `fail`.

On this review host, Playwright 1.62.1 located system Chromium, but Chromium
failed before opening a page with `socket() failed: Operation not permitted`.
The exact launch failure is preserved in `evidence/browser-smoke.json`.
