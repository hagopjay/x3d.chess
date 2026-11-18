# Server and rules reliability pass

This pass preserves the shared UCI pool and multi-board spectator architecture.
The server's chess state is authoritative; scene animation and numeric overlays
are views of that state. Source baseline: `dea017f6b4e13abdbbe11553aeac131a3d80704d`.

## Repairs

| Boundary | Previous behavior | Current behavior |
|---|---|---|
| Engine lifetime | Failed engine returned to the free queue; partial startup leaked earlier processes | Failed, timed-out or cancelled leases retire their process; the next lease recreates the slot; partial startup closes all started processes |
| Shutdown | Waiting searches and setup failures could outlive the server | Closing cancels active/waiting searches; startup and runner cleanup share a `finally` path |
| Move authority | Malformed/illegal UCI replies could terminate a game task; a missing move became a ply-cap draw | Replies are checked against legal moves, errors retry the unchanged board, and no false result is emitted |
| Evaluation identity | A search of one position was attached to the FEN after its move | `eval_fen` and relative `eval_ply` identify the searched pre-move position; `fen` remains the post-move position |
| Score kind | Unknown or mate-zero scores could become ordinary zero centipawns | Unknown remains null; mate scores have a separate kind and retained mate value; mate-zero sign has an explicit score projection |
| Score bounds | Lower/upper bounds could be sampled as exact changes | Bound kind is retained; nonexact scores and mate projections are excluded from swing detection |
| Reconnect | Completed status and played SAN disappeared from snapshots | Snapshots retain generation, state, result, reason, history and the history's `start_fen` |
| Slow SSE client | Removed subscriber kept receiving heartbeats forever | Queue overflow signals EOF, allowing EventSource to reconnect and receive fresh snapshots |
| Opening data | Some names/descriptions disagreed with piece locations or counters; English/Reti began at the initial position | Both books derive all FEN fields from explicit legal SAN prefixes; the Python server retains those prefixes as actual move history |

The pool serves any supported UCI executable. The tested real engine route was
the vendored Stockfish WASM launched under Node. Native Windows Stockfish and
the owner's hardware are separate validation targets.

## Rules and displayed quantities

`python-chess` `Board.outcome(claim_draw=True)` supplies the canonical standard
rule outcome. The spectator automatically accepts an available threefold or
fifty-move claim; those outcomes are marked `adjudicated: true`. Automatic
fivefold/seventy-five-move outcomes remain distinct. The 200 additional-ply cap
is a spectator adjudication, explicitly `reason: "ply_cap"`, not a chess-rule
draw or an engine failure.

An evaluation is White-positive but is not a probability. A pool search score
belongs to the board searched before its returned move. The move event contains
both that evaluation identity and the resulting board identity. `mate_in` is
kept separate; mate display projections never become numerical swing samples.
The backend reports `evaluation_kind` as `engine_cp`, `engine_mate` or
`unavailable`, and `score_bound` as `exact`, `lowerbound`, `upperbound` or
`unknown` when a score exists.

Tactical motifs come from the separately corrected geometric analysis module;
they are candidates or explicit witnesses, not promises that material can be
won. Critical labels describe changes between comparable sampled evaluations,
not move quality inferred from arbitrary score direction.

## Ordering and snapshots

Each board restarts with a new `generation`; its `ply` counts moves played after
the named opening. `seq` is a server-wide high-watermark. Emitted events advance
it, while the fresh snapshots on a connection share the current watermark.
Clients must not require unique snapshot sequence numbers across different
boards or interpret a generation reset as a backwards move in one game.

SSE deliberately sends a current snapshot rather than replaying `Last-Event-ID`.
Queue overflow ends the stream; the standard client reconnects and resynchronizes.
Network writes are bounded to ten seconds. No public route changes board count,
starts executables or accepts chess moves. Current routes are `GET /health`,
`/api/games`, `/api/games/{game_id}`, `/api/snapshot`, `/api/stats` and `/events`.
The historical protocol document's proposed `POST /api/boards` and
`DELETE /api/boards/{id}` are not implemented capabilities.

Server bounds are 1–64 boards, 1–16 UCI processes and depth 1–30. The default
pool is at most four processes, each configured for one thread and 16 MiB hash
where those options exist. These bounds are resource policy, not measured
throughput guarantees. Browser worker limits are a separate route.

## Executed controls

Seventeen focused reliability tests cover partial startup, process death,
illegal/null replies, cancellation, queued-search shutdown, timeout replacement,
mate-zero handling, configuration bounds, initial snapshots, slow-client EOF,
terminal outcomes and draw adjudication, repetition history, recovery after a
bad move, exact opening-book parity, score bounds, real aiohttp routes/SSE,
setup cleanup and executable paths with spaces. Several conditions share one
parameterized test; test count does not equal number of positions.

The original five tests also executed, including mate-in-one through the real
pool and eight boards moving over two vendored engine processes. This is local
software/rules evidence, not native X_ITE pixels, a performance comparison,
native-Windows certification or competitive chess-clock support.

Observed dependencies: Python 3.12.14, `python-chess` distribution 1.999 with
`chess` module 1.11.2, pytest 9.2.0, Node 24.22.1, and the supplied WASM engine.
The exact complete pass results belong to the root release receipt.

```sh
python3 -m pip install -r server/requirements-dev.txt
PYTHONPATH=server python3 -m pytest server/tests -q
PYTHONPATH=server python3 -O -m pytest server/tests/test_reliability.py -q
```

Primary API references: [board outcomes](https://python-chess.readthedocs.io/en/latest/core.html#chess.Board.outcome)
and [engine play, full move history and POV scores](https://python-chess.readthedocs.io/en/latest/engine.html).
