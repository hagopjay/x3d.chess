# Architecture

```
            ┌──────────────── Browser ────────────────┐
            │ X_ITE (X3D scene)  <── SAI ──  scene.js  │
            │                                  ▲       │
            │                         Transport (events)│
            │            ┌─────────────────────┴────┐  │
            │       WasmTransport            SseTransport
            │  stockfish.wasm Web Workers      │       │
            └──────────────┬───────────────────┼───────┘
                           │ (no server)       │ SSE + REST
                           │            ┌──────┴────────────────┐
                           │            │ x3dchess_server (PC)  │
                           │            │ EnginePool (M engines)│
                           │            │ N board coroutines    │
                           │            │ analysis modules      │
                           │            └───────────────────────┘
```

## Why a pool

The original spawned one Stockfish per game (20 processes, depth 12-25, source: `backend/game_manager.py`). A bounded pool (default = CPU cores) leases an engine per move, so 20+ boards fit a small Windows PC. Browser mode runs the same pool logic over Web Workers.

## Two transports, one event stream

| | WasmTransport | SseTransport |
|---|---|---|
| Engine | stockfish.wasm in Workers | native Stockfish via python-chess |
| Host | GitHub Pages (free) | owner's Windows PC (free) |
| Viewers | anyone | LAN / tunnel |
| Strength | lower (WASM, memory cap) | full |
| Events | identical ([PROTOCOL.md](PROTOCOL.md)) | identical |

Spend: $0 for both. No GCP.

## Analysis placement

Pure functions of `(FEN, eval history)`, so they run in either place. Python versions are ported as-is from the backup; JS versions (chess.js based) are needed for WasmTransport. Parity between them is a tested gate (same FEN set, same motifs) in phase 3.
