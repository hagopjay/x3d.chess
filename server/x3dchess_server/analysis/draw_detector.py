"""
Draw Detector - Comprehensive draw detection in chess positions
Detects threefold repetition, 50-move rule, insufficient material, and stalemate
"""
import chess
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass
from enum import Enum

# Configure logging
logger = logging.getLogger(__name__)


class DrawType(Enum):
    """Types of draw conditions"""
    THREEFOLD_REPETITION = "threefold_repetition"
    FIFTY_MOVE_RULE = "fifty_move_rule"
    INSUFFICIENT_MATERIAL = "insufficient_material"
    STALEMATE = "stalemate"
    AGREEMENT = "agreement"  # Player agreement (not detected)


@dataclass
class DrawInfo:
    """Information about a detected draw"""
    draw_type: DrawType
    description: str
    move_number: int
    fen: str
    additional_info: Dict = None

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'draw_type': self.draw_type.value,
            'description': self.description,
            'move_number': self.move_number,
            'fen': self.fen,
            'additional_info': self.additional_info or {}
        }


class DrawDetector:
    """
    Comprehensive draw detection for chess positions.

    Detects all standard draw conditions:
    - Threefold repetition
    - 50-move rule (no pawn moves or captures)
    - Insufficient material to checkmate
    - Stalemate

    Usage:
        detector = DrawDetector()
        draw_info = detector.detect_draw(board, position_history)
        if draw_info:
            print(f"Draw detected: {draw_info.draw_type}")
    """

    def __init__(self):
        """Initialize draw detector"""
        logger.info("DrawDetector initialized")

    def detect_draw(self, board: chess.Board, position_history: List[str] = None) -> Optional[DrawInfo]:
        """
        Detect if current position is a draw by any rule.

        Args:
            board: python-chess Board object
            position_history: List of previous position FENs (for repetition detection)

        Returns:
            DrawInfo if draw detected, None otherwise
        """
        # Check in order of most common to least common

        # 1. Check for stalemate (most common in games)
        if self._is_stalemate(board):
            return DrawInfo(
                draw_type=DrawType.STALEMATE,
                description="Stalemate - no legal moves but not in check",
                move_number=len(board.move_stack),
                fen=board.fen(),
                additional_info={'turn': 'white' if board.turn else 'black'}
            )

        # 2. Check for insufficient material
        material_draw = self._check_insufficient_material(board)
        if material_draw:
            return DrawInfo(
                draw_type=DrawType.INSUFFICIENT_MATERIAL,
                description=material_draw,
                move_number=len(board.move_stack),
                fen=board.fen(),
                additional_info={}
            )

        # 3. Check for threefold repetition
        if position_history:
            repetition_draw = self._check_threefold_repetition(board, position_history)
            if repetition_draw:
                return repetition_draw

        # 4. Check for 50-move rule
        fifty_move_draw = self._check_fifty_move_rule(board)
        if fifty_move_draw:
            return fifty_move_draw

        # No draw detected
        return None

    def _is_stalemate(self, board: chess.Board) -> bool:
        """
        Check if position is stalemate.

        Stalemate occurs when:
        - Side to move has no legal moves
        - King is NOT in check

        Args:
            board: python-chess Board object

        Returns:
            True if stalemate
        """
        # Must not be in check
        if board.is_check():
            return False

        # Must have no legal moves
        return not any(board.legal_moves)

    def _check_insufficient_material(self, board: chess.Board) -> Optional[str]:
        """
        Check for insufficient material to checkmate.

        Draw patterns:
        - King vs King
        - King + Bishop vs King
        - King + Knight vs King
        - King + Bishop vs King + Bishop (bishops on same color)

        Args:
            board: python-chess Board object

        Returns:
            Description string if draw, None otherwise
        """
        # Count material for both sides
        white_material = self._count_material(board, chess.WHITE)
        black_material = self._count_material(board, chess.BLACK)

        # King vs King
        if white_material == {'K': 1} and black_material == {'K': 1}:
            return "Insufficient material: King vs King"

        # King + minor piece vs King
        if (white_material == {'K': 1, 'N': 1} or white_material == {'K': 1, 'B': 1}) and black_material == {'K': 1}:
            return "Insufficient material: King + minor piece vs King"

        if (black_material == {'K': 1, 'N': 1} or black_material == {'K': 1, 'B': 1}) and white_material == {'K': 1}:
            return "Insufficient material: King vs King + minor piece"

        # King + Bishop vs King + Bishop (same color bishops)
        if white_material == {'K': 1, 'B': 1} and black_material == {'K': 1, 'B': 1}:
            # Check if bishops are on same color
            white_bishop_sq = self._find_piece_square(board, chess.BISHOP, chess.WHITE)
            black_bishop_sq = self._find_piece_square(board, chess.BISHOP, chess.BLACK)

            if white_bishop_sq and black_bishop_sq:
                white_color = (chess.square_rank(white_bishop_sq) + chess.square_file(white_bishop_sq)) % 2
                black_color = (chess.square_rank(black_bishop_sq) + chess.square_file(black_bishop_sq)) % 2

                if white_color == black_color:
                    return "Insufficient material: King + Bishop vs King + Bishop (same color)"

        # No insufficient material draw
        return None

    def _count_material(self, board: chess.Board, color: chess.Color) -> Dict[str, int]:
        """
        Count pieces for a side.

        Args:
            board: python-chess Board object
            color: Side to count

        Returns:
            Dictionary mapping piece symbols to counts
        """
        material = {'K': 0, 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0}

        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece and piece.color == color:
                symbol = piece.symbol().upper()
                material[symbol] += 1

        return material

    def _find_piece_square(self, board: chess.Board, piece_type: chess.PieceType, color: chess.Color) -> Optional[chess.Square]:
        """Find square containing a specific piece"""
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece and piece.piece_type == piece_type and piece.color == color:
                return square
        return None

    def _check_threefold_repetition(self, board: chess.Board, position_history: List[str]) -> Optional[DrawInfo]:
        """
        Check for threefold repetition.

        Threefold repetition occurs when the same position occurs
        three times (not necessarily consecutively).

        Args:
            board: python-chess Board object
            position_history: List of position FENs (position part only)

        Returns:
            DrawInfo if repetition detected, None otherwise
        """
        # Get current position (just the piece placement, not move counters)
        current_position = board.fen().split()[0]

        # Count occurrences in history
        count = position_history.count(current_position)

        # Check if we've reached 3 repetitions
        if count >= 3:
            return DrawInfo(
                draw_type=DrawType.THREEFOLD_REPETITION,
                description=f"Threefold repetition - position occurred {count} times",
                move_number=len(board.move_stack),
                fen=board.fen(),
                additional_info={'repetitions': count, 'position': current_position}
            )

        return None

    def _check_fifty_move_rule(self, board: chess.Board) -> Optional[DrawInfo]:
        """
        Check for 50-move rule draw.

        The 50-move rule states that if 50 moves (by each player) have been
        made without a pawn move or capture, either player may claim a draw.

        Args:
            board: python-chess Board object

        Returns:
            DrawInfo if 50-move rule applies, None otherwise
        """
        # Get halfmove clock from board
        halfmove_clock = board.halfmove_clock

        # 50 moves = 100 halfmoves (50 by each player)
        if halfmove_clock >= 100:
            return DrawInfo(
                draw_type=DrawType.FIFTY_MOVE_RULE,
                description=f"50-move rule: no pawn move or capture for {halfmove_clock // 2} full moves",
                move_number=len(board.move_stack),
                fen=board.fen(),
                additional_info={'halfmove_clock': halfmove_clock}
            )

        return None

    def can_claim_draw(self, board: chess.Board, position_history: List[str] = None) -> Dict[str, bool]:
        """
        Check which draw claims are available.

        Args:
            board: python-chess Board object
            position_history: List of position FENs for repetition detection

        Returns:
            Dictionary with boolean flags for each draw type
        """
        return {
            'threefold_repetition': self._check_threefold_repetition(board, position_history or []) is not None,
            'fifty_move_rule': self._check_fifty_move_rule(board) is not None,
            'insufficient_material': self._check_insufficient_material(board) is not None,
            'stalemate': self._is_stalemate(board)
        }

    def get_draw_probability(self, board: chess.Board) -> float:
        """
        Estimate probability of draw based on material imbalance.

        Simple heuristic based on material remaining and game phase.

        Args:
            board: python-chess Board object

        Returns:
            Float from 0.0 to 1.0 representing draw probability
        """
        white_material = self._count_material(board, chess.WHITE)
        black_material = self._count_material(board, chess.BLACK)

        # Calculate total material (excluding kings)
        white_points = sum({
            'Q': 9, 'R': 5, 'B': 3, 'N': 3, 'P': 1
        }.get(piece, 0) * count for piece, count in white_material.items())

        black_points = sum({
            'Q': 9, 'R': 5, 'B': 3, 'N': 3, 'P': 1
        }.get(piece, 0) * count for piece, count in black_material.items())

        total_material = white_points + black_points

        # Base probability on material
        if total_material <= 3:
            # Very low material - high draw probability
            return 0.8
        elif total_material <= 10:
            # Low material - moderate draw probability
            return 0.4
        elif total_material <= 20:
            # Medium material - low draw probability
            return 0.2
        else:
            # High material - very low draw probability
            return 0.1

    def get_position_hash(self, board: chess.Board) -> str:
        """
        Get a hash of the position for repetition detection.

        Includes piece placement, castling rights, and en passant square.
        Excludes move counters and fifty-move counter.

        Args:
            board: python-chess Board object

        Returns:
            String hash of position
        """
        fen = board.fen()
        parts = fen.split()

        # Return first 4 parts: piece placement, turn, castling, en passant
        # Exclude halfmove clock and fullmove number
        return ' '.join(parts[:4])
