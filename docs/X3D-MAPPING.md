# Concept to X3D mapping

Node names are a **stable contract** between scene and SAI layer. Phase 1 change: squares live inside `PROTO ChessBoard`, so they are no longer individually named; each board is `board_<i>` with fields `tintDark`, `tintLight`, `evalScale`, and pieces are runtime nodes tracked per board by `viewer/js/board.js`. `board.x3d` (the phase 0 single board) keeps the `sq_*` names.

| Chess Spectator (2D) | X3D (3D) | Names / nodes |
|---|---|---|
| 4x5 board grid | `Transform` per board in a `Group`; one `ProtoDeclare ChessBoard` instanced N times | `board_<id>` |
| Square | `Transform` + `Shape` (Box) with shared `Appearance` via DEF/USE | `sq_a1`..`sq_h8` |
| Piece | `Transform` + piece mesh (`Shape`/`Inline` glb later) | `piece_<square>` |
| Move animation | `PositionInterpolator` + `TimeSensor`, or SAI-driven translation | per move |
| Eval bar | scaled `Transform` + `Material` | `evalbar` |
| Eval-tinted board | `Material.emissiveColor` set on shared appearances | `darkApp`, `lightApp` |
| Capture particles | `ParticleSystem` + `PointEmitter` | `fx_capture` |
| Check flash | pulsing `Material.transparency` on `sq_<king>` | |
| Pressure heatmap | per-square overlay `Shape` with `ColorRGBA` | `heat_<square>` |
| Phase space (material, space, king safety) | 3D `IndexedLineSet` trajectory + axes + `Text` | `phase_<id>` |
| Convergence chart | `IndexedLineSet` polylines in a HUD `ProximitySensor` frame | |
| Eval graph | `Polyline2D`/`IndexedLineSet` | |
| Tactics (fork, pin, skewer, discovery, overloading) | highlight lines between squares + `Text` annotation | `tac_*` |
| Critical moments | marker billboards on the eval graph | |
| Game modal | `TouchSensor` on a board, `Viewpoint` fly-to | `vp_<id>` |
| Theme store | swap `Appearance` sets | |
| Neon glow | emissive materials + bloom shader (X_ITE shader, later Babylon FX) | |

Phase 4: `PROTO ChessBoard` gained `darkColor`, `lightColor` (themes) and `touchTime` (an outputOnly SFTime from a `TouchSensor`, so a click on any board is an X3D event); named `Background bg`, `NavigationInfo nav` (TELEPORT) and `Viewpoint vp_focus`, which `camera.js` drives for fly-to. Overlays and pieces set `pointerEvents='false'` so clicks reach the board's TouchSensor.

Built and validated: PROTO board grid, runtime pieces, eval bar and tint, last-move highlight, tactic lines (`IndexedLineSet`), 3D phase space with trails, two named viewpoints (`vp_overview`, `vp_phase`).
