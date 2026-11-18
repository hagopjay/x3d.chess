"""Typed server event contract; browser transports use the same public fields.

FEN on a move is post-move. A UCI search score is explicitly bound to the
pre-move eval_fen/eval_ply instead. Centipawns are White-positive, unavailable
scores stay null, and mate scores are never substituted into swing analysis.
`seq` is a server high-watermark; reconnect snapshots may share that value.
`generation` and relative `ply` identify each board's restarted game.
"""
from typing import Literal, TypedDict


class MoveEvent(TypedDict):
    type: Literal["move"]
    game_id: str
    generation: int
    seq: int
    ply: int
    san: str
    uci: str
    fen: str
    eval_cp: int | None
    eval_fen: str
    eval_ply: int
    mate_in: int | None
    evaluation_kind: Literal["engine_cp", "engine_mate", "unavailable"]
    eval_source: Literal["uci_search"]
    score_bound: Literal["exact", "lowerbound", "upperbound", "unknown"] | None
    depth: int
    nodes: int
    tactics: list[dict]       # Geometric candidates/witnesses, not forced-win claims.
    critical: str | None      # Neutral evaluation swing or material-exchange label.
    critical_for_ply: int | None
    captured: bool | None


class SnapshotGameEvent(TypedDict):
    type: Literal["snapshot_game"]
    game_id: str
    generation: int
    seq: int
    fen: str
    start_fen: str
    history: list[str]         # SAN suffix played since the named opening.
    ply: int
    opening: str
    skill: int
    state: Literal["playing", "complete"]
    result: str | None
    reason: str | None
    adjudicated: bool
    eval_cp: int | None
    eval_fen: str | None
    eval_ply: int | None
    mate_in: int | None
    evaluation_kind: Literal["engine_cp", "engine_mate", "unavailable"]
    eval_source: Literal["uci_search", "unknown"]
    score_bound: Literal["exact", "lowerbound", "upperbound", "unknown"] | None


class GameCompleteEvent(TypedDict):
    type: Literal["game_complete"]
    game_id: str
    generation: int
    seq: int
    result: Literal["1-0", "0-1", "1/2-1/2"]
    reason: str              # Includes rule outcomes and explicit ply_cap adjudication.
    adjudicated: bool
    draw_policy: Literal["claim_available"]
    fen: str
    ply: int
    state: Literal["complete"]


class PhaseSpaceEvent(TypedDict):
    type: Literal["phase_space_update"]
    game_id: str
    generation: int
    seq: int
    fen: str
    material_balance: float
    space_control: float
    king_safety: float
    move_number: int


class ConvergenceEvent(TypedDict):
    type: Literal["convergence_update"]
    seq: int
    summary: dict
    pairs: list[dict]
    outliers: list[dict]
