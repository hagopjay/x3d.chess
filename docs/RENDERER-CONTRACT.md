# Renderer contract and measured controls

`createScene` owns the initial X3D world. The canvas must not concurrently load
its own `src`. The local `scenes/grid.x3d` supplies the trusted ChessBoard PROTO;
runtime instances and cameras are rebuilt for the actual requested board count.
This is a fixed-template builder, not a general importer.

`gridLayout` in `viewer/js/layout.js` supplies every board and piece origin.
Counts 1–64 are supported structurally. Columns default to five and are reduced
for smaller collections. Board coordinates are right-handed Y-up; files increase
along +X and rank 1 is on the +Z edge. Structural support is not a frame-rate
claim for 64 boards on every device.

## Asynchronous acceptance

- A board starts, and a new generation starts, with `snapshot_game` (the
  `snapshot` alias is also accepted). Game identifiers are `g0` through `gN−1`.
- Full FEN validation precedes advancement of the accepted generation/sequence.
  An invalid newer snapshot therefore cannot make a later valid state stale.
- Supplied generations and sequence numbers must be nonnegative integers.
  Older generations, duplicate sequences, nonincreasing move plies and moves
  after completion are rejected. Legacy streams without generation/sequence
  metadata have weaker stale-event guarantees.
- Each snapshot invalidates older asynchronous piece and effect work. It clears
  actual move/study cues, graph coordinates and phase-space trail geometry.
- Board geometry queues recover after rejection. Graph and heat shapes share
  an in-flight creation promise; a late heat enable cannot override a newer off.
- Themes are serialized, and piece creation uses an explicit per-board palette.
  Another scene changing the default palette does not recolor that build.
- `dispose()` stops the animation loop, removes picking callbacks and persistent
  overlays, and cancels capture effects. Reduced motion skips piece hops and
  capture bursts.

## Study and export hooks

```js
await scene.onEvent({
  type: 'snapshot_game', game_id: 'g0', generation: 1, ply: 0,
  fen, eval_cp: null, state: 'playing'
});
await scene.setStudyHighlights({
  squares: [{ square: 'e7', color: [0.3, 0.9, 0.6] }],
  lines: [{ from: 'e1', to: 'e8', color: '1 0.7 0.2' }]
}, 0);
```

Study colors require three finite RGB values in [0,1]. Overlays are bounded to
64 square highlights and 128 relation arcs. The arcs represent relationships,
not physical piece paths or proof that an attack wins material. A caller
switching studies must keep its own selection revision across awaits before
issuing new highlights; the board cannot infer that a newly issued request
belongs to an obsolete UI selection.

`scene.gridXml` is the generated board scene. `scene.browser` gives the owning
browser. `await scene.exportX3D()` waits for pending renderer work and calls the
runtime scene serializer; the portable exporter owns any removal of X_ITE-only
attributes, provenance labeling and subsequent schema checks.

## Checks executed in this pass

`node tools/renderer-tests.mjs` passes **11 controls** using the actual renderer
modules with a small SAI adapter. It covers requested layouts at 1, 2, 20, 21 and
64 boards; malformed placement/overlay refusal; asynchronous failures and
snapshot cancellation; graph and heat races; study overlay ordering; rejection
recovery; generation/sequence/terminal acceptance; palette isolation; and
construction/disposal at 1 and 21 boards.

Separately generated runtime grids at 1, 20 and 64 boards passed the pinned
X3D 4.0 schema and semantic instrument already used by Research Loom
(`hagopjay/x3d_mcp@b5c9956917714747fe1d034c729612e99b0f09c9`).
These checks establish model/adapter behavior and scene structure. Native
X_ITE browser pixels and hardware frame rates require their own fresh evidence.
