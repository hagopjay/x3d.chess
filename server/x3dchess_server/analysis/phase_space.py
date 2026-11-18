"""
Phase Space - Game DNA Visualization

Encodes game states as 3D vectors for visualization:
- Material balance: Piece values on board (P=1, N=3, B=3, R=5, Q=9)
- Space control: Squares attacked/controlled by each side
- King safety: Pawn shield strength + enemy piece proximity
"""
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
import chess
import numpy as np


@dataclass
class PhaseSpacePoint:
    """3D representation of a game state"""
    material_balance: float
    space_control: float
    king_safety: float
    move_number: int
    fen: str

    def to_vector(self) -> np.ndarray:
        return np.array([self.material_balance, self.space_control, self.king_safety])

    def to_dict(self) -> Dict[str, Any]:
        return {
            'material_balance': round(self.material_balance, 2),
            'space_control': round(self.space_control, 2),
            'king_safety': round(self.king_safety, 2),
            'move_number': self.move_number,
            'fen': self.fen
        }


@dataclass
class PhaseSpaceTrajectory:
    """Complete trajectory through phase space"""
    game_id: str
    points: List[PhaseSpacePoint] = field(default_factory=list)
    current_point: Optional[PhaseSpacePoint] = None

    def add_point(self, point: PhaseSpacePoint):
        self.points.append(point)
        self.current_point = point

    def get_velocity(self) -> np.ndarray:
        if len(self.points) < 2:
            return np.zeros(3)
        return self.points[-1].to_vector() - self.points[-2].to_vector()

    def get_acceleration(self) -> np.ndarray:
        if len(self.points) < 3:
            return np.zeros(3)
        vel_current = self.points[-1].to_vector() - self.points[-2].to_vector()
        vel_previous = self.points[-2].to_vector() - self.points[-3].to_vector()
        return vel_current - vel_previous

    def to_dict(self) -> Dict[str, Any]:
        return {
            'game_id': self.game_id,
            'points': [p.to_dict() for p in self.points[-10:]],
            'point_count': len(self.points),
            'current_point': self.current_point.to_dict() if self.current_point else None,
            'velocity': self.get_velocity().tolist(),
            'acceleration': self.get_acceleration().tolist()
        }


class PhaseSpaceAnalyzer:
    """Analyzes games in 3D phase space"""

    PIECE_VALUES = {
        chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
        chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0
    }

    def __init__(self):
        self.trajectories: Dict[str, PhaseSpaceTrajectory] = {}

    def analyze_position(self, game_id: str, fen: str, move_number: int) -> PhaseSpacePoint:
        board = chess.Board(fen)

        material_balance = self._calculate_material_balance(board)
        space_control = self._calculate_space_control(board)
        king_safety = self._calculate_king_safety(board)

        point = PhaseSpacePoint(
            material_balance=material_balance,
            space_control=space_control,
            king_safety=king_safety,
            move_number=move_number,
            fen=fen
        )

        if game_id not in self.trajectories:
            self.trajectories[game_id] = PhaseSpaceTrajectory(game_id=game_id)
        self.trajectories[game_id].add_point(point)
        return point

    def _calculate_material_balance(self, board: chess.Board) -> float:
        white_material = 0
        black_material = 0
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                value = self.PIECE_VALUES.get(piece.piece_type, 0)
                if piece.color == chess.WHITE:
                    white_material += value
                else:
                    black_material += value
        return white_material - black_material

    def _calculate_space_control(self, board: chess.Board) -> float:
        white_control = 0
        black_control = 0
        center_squares = [chess.E4, chess.D4, chess.E5, chess.D5]
        extended_center = [chess.C3, chess.D3, chess.E3, chess.F3,
                          chess.C4, chess.F4, chess.C5, chess.F5,
                          chess.C6, chess.D6, chess.E6, chess.F6]

        for square in chess.SQUARES:
            white_attackers = len(board.attackers(chess.WHITE, square))
            black_attackers = len(board.attackers(chess.BLACK, square))
            weight = 3.0 if square in center_squares else (2.0 if square in extended_center else 1.0)
            white_control += white_attackers * weight
            black_control += black_attackers * weight

        normalized = (white_control - black_control) / 200.0
        return max(-5.0, min(5.0, normalized * 10))

    def _calculate_king_safety(self, board: chess.Board) -> float:
        return self._calculate_side_king_safety(board, chess.WHITE) - \
               self._calculate_side_king_safety(board, chess.BLACK)

    def _calculate_side_king_safety(self, board: chess.Board, color: chess.Color) -> float:
        king_square = board.king(color)
        if king_square is None:
            return 0.0

        safety = 5.0
        king_rank = chess.square_rank(king_square)
        king_file = chess.square_file(king_square)
        direction = 1 if color == chess.WHITE else -1

        # Only real neighboring files: an a/h-file king has two shield squares,
        # not a duplicated edge square. This feature remains a heuristic.
        shield_files = range(max(0, king_file - 1), min(7, king_file + 1) + 1)
        shield_rank = king_rank + direction

        PAWN_SHIELD_BONUS = 0.5
        ENEMY_PROXIMITY_PENALTY = 0.3

        if 0 <= shield_rank < 8:
            for shield_file in shield_files:
                shield_square = chess.square(shield_file, shield_rank)
                piece = board.piece_at(shield_square)
                if piece and piece.piece_type == chess.PAWN and piece.color == color:
                    safety += PAWN_SHIELD_BONUS
                else:
                    safety -= PAWN_SHIELD_BONUS

        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece and piece.color != color:
                distance = abs(chess.square_rank(square) - king_rank) + \
                          abs(chess.square_file(square) - king_file)
                if distance <= 3:
                    safety -= ENEMY_PROXIMITY_PENALTY

        return max(-5.0, min(5.0, safety))

    def get_trajectory(self, game_id: str) -> Optional[PhaseSpaceTrajectory]:
        return self.trajectories.get(game_id)

    def reset_game(self, game_id: str):
        if game_id in self.trajectories:
            self.trajectories[game_id] = PhaseSpaceTrajectory(game_id=game_id)

    def reset_all(self):
        self.trajectories.clear()
