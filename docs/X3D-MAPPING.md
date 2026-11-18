# Concept to X3D mapping

Node names are a **stable contract** between scene and SAI layer.

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

First slice already built and validated: board, `sq_*` naming, `evalbar`, one `piece_e2`.
