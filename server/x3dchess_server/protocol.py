"""Wire events, shared by the Python server and the browser WasmTransport (docs/PROTOCOL.md).

Names and fields are ported 1:1 from the chess-spectator backup so its analysis modules
drop in unchanged: move, game_complete, convergence_update, phase_space_update.
"""
from typing import Literal, TypedDict

class MoveEvent(TypedDict):
    type: Literal["move"]
    game_id: str
    ply: int
    san: str
    uci: str
    fen: str
    eval_cp: int | None
    mate_in: int | None
    tactics: list[dict]          # fork | pin | skewer | discovery | overloading
    critical: str | None         # blunder | mistake | inaccuracy | sharp_change | phase_transition

class GameCompleteEvent(TypedDict):
    type: Literal["game_complete"]
    game_id: str
    result: str                  # 1-0 | 0-1 | 1/2-1/2
    reason: str                  # checkmate | stalemate | threefold | fifty_move | insufficient_material

class PhaseSpaceEvent(TypedDict):
    type: Literal["phase_space_update"]
    game_id: str
    material_balance: float
    space_control: float
    king_safety: float
    move_number: int

class ConvergenceEvent(TypedDict):
    type: Literal["convergence_update"]
    pairs: list[dict]            # {a, b, score}
    outliers: list[str]
