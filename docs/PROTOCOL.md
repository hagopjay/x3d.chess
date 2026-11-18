# Event protocol

Carried over SSE (`GET /events`, `data: <json>`) or delivered in-process by WasmTransport. Types in `server/x3dchess_server/protocol.py`. Names match the original backend so ports are 1:1.

| Event | Key fields | Origin (backup) |
|---|---|---|
| `move` | game_id, ply, san, uci, fen, eval_cp, mate_in, tactics[], critical | `game_manager.py` line ~401 |
| `game_complete` | game_id, result, reason | line ~446 |
| `phase_space_update` | game_id, material_balance, space_control, king_safety, move_number | line ~329 |
| `convergence_update` | pairs[], outliers[] | line ~309 |
| `snapshot` (new) | full state of all boards, sent on connect | `get_snapshot` |

REST: `GET /health`, `GET /api/games`, `GET /api/games/{id}`, `GET /api/snapshot`, `GET /api/stats` (as in `main.py`). Added in phase 2: `POST /api/boards` (start N boards with config), `DELETE /api/boards/{id}`.

Board config: `{name, depth, opening, speed_ms, start_fen}`. Cap on concurrent boards is enforced by the pool, not the client.
