# Event protocol

Game state reaches the viewer either as JSON on `GET /events` or through a
browser callback. The Python definitions in
`server/x3dchess_server/protocol.py` describe server event shapes; the browser
routes share their game fields but have explicit route-specific additions.
TypedDict annotations are documentation/type checking, not a runtime JSON
schema validator.

| Route | Producer | Evaluation meaning |
|---|---|---|
| `wasm` | Real Stockfish workers | Engine score for the searched pre-move position |
| `sse` | Python GameManager over a shared UCI pool | Engine score for the searched pre-move position |
| `replay` | Seeded random legal playouts, not recorded engine games | Material proxy for the post-move position |
| `study` | Selected saved position and legal-move exploration | Unavailable; rule witnesses do not invent an engine evaluation |

## Implemented HTTP endpoints

All current server application endpoints are read-only:

| Method and path | Response |
|---|---|
| `GET /health` | `ok`, application version and current pool/game statistics |
| `GET /api/games` | `{games: [snapshot_game, ...]}` |
| `GET /api/games/{game_id}` | One snapshot; an unknown ID returns HTTP 404 |
| `GET /api/snapshot` | Same snapshot collection as `/api/games` |
| `GET /api/stats` | Board/process counts, searches, nodes, busy seconds, moves, clients, depth, process health and draw policy |
| `GET /events` | UTF-8 `text/event-stream`; each event is `data: <JSON>\n\n` |

`POST /api/boards` and `DELETE /api/boards/{id}` appeared in the earlier design
but are **not implemented**. There is no HTTP move submission, executable
selection or board-configuration API. Configure server board count, process
count, search depth, seed and engine command at startup. Server bounds are
1–64 boards, 1–16 processes and depth 1–30; browser worker bounds are separate.

The server sends an SSE comment heartbeat after 15 seconds without a queued
event. Each network write has a ten-second timeout. A slow subscriber's bounded
queue is discarded and its stream ends, prompting EventSource to reconnect.
The internal close sentinel is not serialized as a game event.

## Game events

| Event | Core fields | Availability |
|---|---|---|
| `snapshot_game` | `game_id`, `generation`, `seq`, `fen`, `ply`, evaluation fields; optional opening/skill and restored state/history | All routes; server sends one per board on connect and restart |
| `move` | `game_id`, `generation`, `seq`, `ply`, `san`, `uci`, post-move `fen`, evaluation fields, `tactics`, `critical`, `critical_for_ply`, `captured` | Engine and replay routes |
| `game_complete` | `game_id`, `generation`, `seq`, `result`, `reason`, `state: "complete"`, adjudication/policy fields | Engine and replay routes |
| `phase_space_update` | `game_id`, `generation`, `seq`, `fen`, `move_number`, `material_balance`, `space_control`, `king_safety` | Server/WASM/replay; ordinarily every fourth additional ply |
| `convergence_update` | `seq`, `summary`, `pairs`, `outliers` | Server only |

Engine move events also include search `depth` and `nodes`. Browser move events
carry chess.js `flags`; their `captured` value is a captured piece symbol or
null. The server's `captured` is a boolean or null. Consumers should test its
presence/truthiness rather than assume one cross-route piece-code type.

### Evaluation identity and kind

`fen` on a `move` is the position **after** that move. An engine returned its
score while searching the position before it, so that separate position is
carried in `eval_fen`, with its relative `eval_ply`. For an engine move at
`ply: 1`, an ordinary first search therefore has `eval_ply: 0`. Replay's material
proxy is recomputed after the move, so its evaluation and move FENs coincide.

| Field | Meaning |
|---|---|
| `eval_cp` | White-positive centipawns for `engine_cp`, or explicitly labelled material units scaled by 100 for `material_proxy`; null when unavailable |
| `evaluation_kind` | `engine_cp`, `engine_mate`, `material_proxy` or `unavailable`, according to the producer |
| `eval_fen`, `eval_ply` | Identity of the evaluated position; null before an engine score or in rules-only study |
| `mate_in` | Signed White-perspective engine mate value, kept separate from an ordinary centipawn score |
| `score_bound` | Engine search bound: `exact`, `lowerbound`, `upperbound`, `unknown` or null; absent on the material-proxy route |
| `eval_source` | Server-specific `uci_search` or `unknown`; `evaluation_kind` is the common display contract |
| `critical_for_ply` | Position/sample to which the neutral critical label applies; null when no label exists |

An engine mate value uses a visual evaluation projection, not an ordinary
centipawn measurement or a win probability. Mate values and nonexact search
bounds are excluded from evaluation-swing comparisons. A null score remains
unavailable rather than becoming a measured zero. The paired FEN and kind must
travel with an exported figure or evaluation trace.

### Tactical and critical annotations

`tactics` contains at most three bounded geometric records. The current fields
are `pattern`, `piece`, `piece_color`, `piece_square`, `target_squares`,
`target_pieces`, `severity`, `description`, `status`, `witness_moves` and
`revealed_square`. Emitted patterns are `fork`, `pin`, `skewer` and `discovery`.
The reserved `overload` enum does not produce an unsupported overload heuristic.

Severity is `candidate`, not a forced-win assertion. `status` distinguishes
`geometric_candidate`, `absolute_pin` and `legal_move_witness`; legal witness
moves are UCI strings. Static geometry inspects both colors. A discovery witness
requires a legal move by the side to move. Geometric attack counts and legal
move counts are different quantities.

`critical` is null or a neutral `large_swing`, `medium_swing`, `small_swing` or
`material_exchange` label. It is not a blunder/mistake grade. It describes
comparable sampled positions, whose frame is `critical_for_ply`, rather than
claiming that every score change was caused by the displayed move.

## Ordering, restart and reconnect

`generation` identifies each board's restarted game. Its `ply` counts moves
played after the named opening; explicit SAN prefixes initialize both opening
books, and engine routes retain their history for repetition-aware searches.
Browser game-event `seq` counters are per game/generation. Server `seq` is a
global emitted-event high-watermark; its reconnect snapshots can share the
same sequence value across boards. Sequence gaps are not a replay guarantee.

The SSE endpoint does not replay `Last-Event-ID` or assign SSE `id:` fields.
Every connection receives fresh snapshots, queued before subsequent live
events. A server snapshot also retains:

- `start_fen`: position from which its displayed SAN suffix begins;
- `history`: SAN moves played after that opening position;
- `state`: `playing` or `complete`;
- `result`, `reason`, `adjudicated`: completion data, including during the
  pause before restart;
- the last evaluation's kind, mate value and pre-move identity.

Clients should apply a snapshot as authoritative current state, restore history
against `start_fen`, and clear old visual cues. They should not require unique
server snapshot sequence numbers across different boards. Study selections use
fresh snapshot generations as position revisions; their `source_fen` preserves
the original saved input while `fen` identifies the currently explored position.

A FEN contains position state and move counters, not a repetition history.
The server's SAN suffix restores the displayed line; reconstructing the whole
game also requires the named opening prefix. The authoritative engine routes
retain that prefix internally. A position loaded from an isolated FEN cannot
prove that it has already occurred three times, and a snapshot is not a general
PGN/archive format.

## Completion and draw policy

The server uses python-chess `Board.outcome(claim_draw=True)`: its spectator
policy accepts an available threefold/fifty-move claim, including a claim
available with an intended legal move. Those outcomes and the additional-ply
cap are marked `adjudicated: true`. Automatic fivefold/seventy-five-move outcomes
remain distinct. A 200-ply cap is a spectator adjudication, not a chess-rule draw
or a missing-engine-move result.

Browser game routes check draw conditions in the current position. The current
route strings are retained explicitly:

| Condition | Server reason/policy | Browser reason/policy |
|---|---|---|
| Checkmate, stalemate, insufficient material | `checkmate`, `stalemate`, `insufficient_material` | Same strings |
| Threefold/fifty-move | `threefold`, `fifty_move`; `draw_policy: "claim_available"` | Same reason IDs; `draw_policy: "claim_current_position"` |
| Fivefold/seventy-five-move | `fivefold`, `seventyfive_move` | Same reason IDs |
| Resource cap | `ply_cap`, 200 additional plies | WASM `ply_cap` at 200; replay `replay_cap` at 140 |

Both game routes mark accepted threefold/fifty-move claims and resource caps
as `adjudicated: true`; mandatory rule endings are false. The policy string
preserves the intentional difference: for example, the browser waits at
halfmove clock 99 until a qualifying move reaches 100, while the server may
already accept a claim based on that intended move. Consumers must not infer
cross-route policy identity from matching `result` strings alone. A draw
normally has `result: "1/2-1/2"`; checkmate has `1-0` or `0-1`. Study snapshots
describe their rule outcome without an engine search.
Clocks, resignation, player draw agreements and a general dead-position solver
are not part of this spectator protocol.

## Local lifecycle events

`transport_status` is generated by the browser transport/controller, not by
the Python SSE game stream. Its fields are `transport`, `state`, `message` and
optional details such as worker count. States include `starting`, `running`,
`retrying`, `stopped` and `error`.

For SSE, `running` means that the connection opened, not that every engine is
healthy or every scene has rendered. Engine failures and actual live-process
counts are exposed through `/api/stats`. The SSE wrapper rejects oversized or
malformed JSON/game identities and ignores callbacks from stopped runs. Its
input string budget is 262,144 JavaScript string code units. A scene callback
failure is not relabelled as malformed server JSON.

No mode silently substitutes replay for an unavailable engine. Display status,
engine scores, material proxies and rule-only studies retain their own meanings.
