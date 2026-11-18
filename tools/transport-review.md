# Browser transports: reviewed changes and limits

The initial pool registered UCI waiters after sending commands, had no handshake
or search deadline, and left outstanding requests pending when workers stopped.
It also sent only the current FEN, discarding the history an engine needs to
recognize repetitions. Replay's per-board stagger callbacks survived `stop()`.
Background WASM failures could become unhandled promise rejections.

The bounded pool now registers a waiter before each command, synchronizes with
`isready`, rejects worker/message errors, and refuses excess queued requests.
A timed-out worker is never lent to another search: all requests settle and the
transport exposes an error. Restart creates a fresh pool. It does not silently
replace failed engine play with random replay.

| Policy | Bound |
|---|---|
| Browser games | 1–64 |
| Workers | 1–8; default remains hardware-dependent, capped at 4 |
| Waiting searches | 64 by default |
| Depth | 1–30 |
| Skill | 0–20 |
| Handshake deadline | 15 s by default |
| Search deadline | 60 s by default |
| Replay interval | 16–60,000 ms |

These are configured limits, not promises of acceptable frame rate or playing
strength on every machine. The position-command parser rejects line breaks and
malformed UCI fields. `chess.js` remains the legal-game authority in the transport;
the pool's FEN syntax check by itself is not a full legality proof.

Every seeded opening now has an explicit legal move prefix supplied by the book.
The WASM game retains that prefix and appends its actual moves. Search requests
send the initial FEN plus UCI history. A worker receives `ucinewgame` when it
changes game identities, rather than on every move of the same game.

Each board emits a generation and increasing sequence number. Stop/restart
invalidates old asynchronous work and cancels all owned delays. Snapshots and
moves use state `playing`; completion uses `complete`. SSE forwards the server's
generation/sequence unchanged and reports connecting, running, retrying and
error states. Malformed server payloads close the stream. The renderer owns
full FEN validation and freshness acceptance before changing a board.

The engine searches the position **before** playing its selected move. Events
therefore bind the score to `eval_fen` and `eval_ply`, and keep mate separate from
centipawns. Scores and score bounds are converted to White's perspective; a
Black-to-move lower bound becomes a White upper bound. Missing scores stay null.
Critical-change analysis receives that source context and skips unavailable,
mate-proxy and nonexact bound samples.

Browser play uses `draw_policy: claim_current_position`: it claims threefold or
fifty-move draws only once the current position has reached that condition.
The Python server explicitly uses `claim_available`; python-chess also recognizes
a legal intended next move that would make either claim available. These are
different spectator policies, not parity-tested competitive claim procedures.
Both use shared reasons `threefold`, `fifty_move`, `fivefold` and `seventyfive_move`.
Claims and move-cap results are `adjudicated: true`; mandatory endings are false.
Checkmate takes precedence. Browser replay keeps its separate `replay_cap` reason.

## Executed controls

`node --test tools/transport-tests.mjs` passes 16 deterministic controls, including
immediate synchronous replies, shutdown during initialization/search/queueing,
timeouts, worker errors, history commands, score perspective/bounds, legal move
and seeded-opening reconstruction, concurrent starts, canceled staggered replay,
draw precedence, current/prospective-claim boundaries, and stale or malformed SSE callbacks. Fake workers are labeled
failure/race instruments, not chess-strength or browser-rendering benchmarks.

`node tools/transport-engine-smoke.mjs [result.json]` separately executes the
vendored Stockfish 19 Lite JS/WASM under Node through the actual pool. It checked
legal mate-in-one results for both colors, White-positive mate signs, and a legal
history-based opening continuation. The JSON output binds the pool, vendor
JS/WASM, chess rules module and checker source by SHA-256.

This second path uses a Node process adapter. It does not establish browser
Worker fetch/initialization, X_ITE pixels, real-time GPU behavior or engine
strength. Those require their own checks.

Primary technical references:

- [Stockfish UCI implementation](https://github.com/official-stockfish/Stockfish/blob/master/src/uci.cpp)
- [Stockfish UCI protocol and commands](https://github.com/official-stockfish/Stockfish/wiki/UCI-&-Commands)
- [chess.js API](https://github.com/jhlywa/chess.js/blob/master/website/docs/index.md)
