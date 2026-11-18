"""
Tactical Detector - Pattern detection for chess tactics
Identifies forks, pins, skewers, discoveries, and overloading
"""
import chess
import logging
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from enum import Enum

# Configure logging
logger = logging.getLogger(__name__)


class TacticalPattern(Enum):
    """Types of tactical patterns"""
    FORK = "fork"
    PIN = "pin"
    SKEWER = "skewer"
    DISCOVERY = "discovery"
    OVERLOAD = "overload"


@dataclass
class TacticalMotif:
    """Represents a detected tactical pattern"""
    pattern: TacticalPattern
    piece: chess.Piece  # The piece delivering the tactic
    piece_square: chess.Square
    target_squares: List[chess.Square]  # Squares affected by the tactic
    target_pieces: List[chess.Piece]  # Pieces under attack
    severity: str  # 'winning', 'material', 'positional'
    description: str

    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'pattern': self.pattern.value,
            'piece': chess.piece_name(self.piece.piece_type),
            'piece_color': 'white' if self.piece.color else 'black',
            'piece_square': chess.square_name(self.piece_square),
            'target_squares': [chess.square_name(sq) for sq in self.target_squares],
            'target_pieces': [f"{chess.piece_name(p.piece_type)}{'' if p.color else ''}" for p in self.target_pieces],
            'severity': self.severity,
            'description': self.description
        }


class TacticalDetector:
    """
    Detects tactical patterns in chess positions.

    Uses python-chess Board methods for efficient pattern detection:
    - Board.attacks(square) - Get squares attacked by piece
    - Board.pin(color, square) - Check if piece is pinned
    - Board.checkers() - Get pieces giving check
    """

    # Piece values for severity assessment
    PIECE_VALUES = {
        chess.PAWN: 1,
        chess.KNIGHT: 3,
        chess.BISHOP: 3,
        chess.ROOK: 5,
        chess.QUEEN: 9,
        chess.KING: 0
    }

    def __init__(self):
        """Initialize tactical detector"""
        logger.info("TacticalDetector initialized")

    def detect_all_patterns(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Detect all tactical patterns in the current position.

        Args:
            board: python-chess Board object

        Returns:
            List of TacticalMotif objects representing detected patterns
        """
        motifs = []

        # Detect forks
        motifs.extend(self.detect_forks(board))

        # Detect pins
        motifs.extend(self.detect_pins(board))

        # Detect skewers
        motifs.extend(self.detect_skewers(board))

        # Detect discoveries
        motifs.extend(self.detect_discoveries(board))

        # Detect overloading
        motifs.extend(self.detect_overloading(board))

        logger.debug(f"Detected {len(motifs)} tactical patterns")
        return motifs

    def detect_forks(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Detect fork tactics (one piece attacks multiple valuable pieces).

        A fork occurs when a piece attacks two or more enemy pieces,
        at least one of which is valuable (queen, rook, or king).

        Args:
            board: python-chess Board object

        Returns:
            List of fork motifs
        """
        forks = []
        turn = board.turn

        # Check all pieces for the side to move
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece or piece.color != turn:
                continue

            # Knights and kings are common fork pieces
            if piece.piece_type in [chess.KNIGHT, chess.KING]:
                attacks = board.attacks(square)
                attacked_pieces = []

                for attack_sq in attacks:
                    target = board.piece_at(attack_sq)
                    if target and target.color != turn:
                        # Only count valuable targets
                        if target.piece_type in [chess.QUEEN, chess.ROOK, chess.KING]:
                            attacked_pieces.append((attack_sq, target))

                # Fork requires at least 2 valuable targets
                if len(attacked_pieces) >= 2:
                    target_squares = [sq for sq, _ in attacked_pieces]
                    target_pieces = [p for _, p in attacked_pieces]

                    # Determine severity
                    has_king = any(p.piece_type == chess.KING for p in target_pieces)
                    has_queen = any(p.piece_type == chess.QUEEN for p in target_pieces)

                    if has_king:
                        severity = 'winning'
                    elif has_queen:
                        severity = 'material'
                    else:
                        severity = 'positional'

                    forks.append(TacticalMotif(
                        pattern=TacticalPattern.FORK,
                        piece=piece,
                        piece_square=square,
                        target_squares=target_squares,
                        target_pieces=target_pieces,
                        severity=severity,
                        description=self._describe_fork(piece, square, attacked_pieces)
                    ))

        return forks

    def detect_pins(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Detect pin tactics (piece cannot move without exposing valuable piece).

        A pin occurs when a piece is immobilized because moving it would
        expose a more valuable piece behind it to attack.

        Args:
            board: chess Board object

        Returns:
            List of pin motifs
        """
        pins = []
        turn = board.turn

        # Check for pins against opponent's pieces
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece or piece.color == turn:
                continue

            # Check if piece is pinned
            # A piece is pinned if it's on the same line as king
            # and would expose king to attack if it moved
            king_square = board.king(piece.color)

            if king_square is not None:
                # Check if piece and king are aligned
                if self._is_aligned(square, king_square):
                    # Check if there's an enemy piece on the line behind
                    direction = self._get_direction(square, king_square)
                    if direction:
                        # Look for enemy piece in opposite direction
                        check_square = square
                        while True:
                            check_square = self._step_square(check_square, direction)
                            if check_square is None:
                                break

                            target = board.piece_at(check_square)
                            if target:
                                if target.color == turn and target.piece_type in [chess.QUEEN, chess.ROOK, chess.BISHOP]:
                                    # Found pinning piece
                                    severity = 'winning' if piece.piece_type == chess.QUEEN else 'material'

                                    pins.append(TacticalMotif(
                                        pattern=TacticalPattern.PIN,
                                        piece=target,
                                        piece_square=check_square,
                                        target_squares=[square],
                                        target_pieces=[piece],
                                        severity=severity,
                                        description=self._describe_pin(target, check_square, piece, square)
                                    ))
                                break

        return pins

    def detect_skewers(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Detect skewer tactics (valuable piece must move, exposing less valuable piece).

        A skewer is like a reverse pin - a valuable piece is attacked and must move,
        exposing a less valuable piece behind it.

        Args:
            board: chess Board object

        Returns:
            List of skewer motifs
        """
        skewers = []
        turn = board.turn

        # Look for skewers by our pieces against opponent
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece or piece.color != turn:
                continue

            # Queen, rook, bishop can skewer
            if piece.piece_type not in [chess.QUEEN, chess.ROOK, chess.BISHOP]:
                continue

            # Get attacked squares
            attacks = board.attacks(square)

            # Check if any attacked square has a valuable piece
            for attack_sq in attacks:
                target = board.piece_at(attack_sq)
                if not target or target.color == turn:
                    continue

                # Check if this is a valuable piece (king or queen)
                if target.piece_type not in [chess.KING, chess.QUEEN]:
                    continue

                # Check if there's a less valuable piece behind it on the same line
                direction = self._get_direction(square, attack_sq)
                if direction:
                    # Look behind the valuable piece
                    check_square = attack_sq
                    while True:
                        check_square = self._step_square(check_square, direction)
                        if check_square is None:
                            break

                        behind_piece = board.piece_at(check_square)
                        if behind_piece:
                            if behind_piece.color != turn and behind_piece.piece_type in [chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT]:
                                # Found skewer
                                severity = 'winning' if target.piece_type == chess.KING else 'material'

                                skewers.append(TacticalMotif(
                                    pattern=TacticalPattern.SKEWER,
                                    piece=piece,
                                    piece_square=square,
                                    target_squares=[attack_sq, check_square],
                                    target_pieces=[target, behind_piece],
                                    severity=severity,
                                    description=self._describe_skewer(piece, square, target, attack_sq, behind_piece, check_square)
                                ))
                            break

        return skewers

    def detect_discoveries(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Discovered attacks - moving a piece reveals an attack by another piece.

        Args:
            board: chess Board object

        Returns:
            List of discovery motifs
        """
        discoveries = []
        turn = board.turn

        # Find our pieces that could discover an attack
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece or piece.color != turn:
                continue

            # Check if moving this piece would reveal an attack
            king_square = board.king(not turn)

            if king_square is not None:
                # Check if piece is between one of our pieces and enemy king
                # or other valuable target
                for other_square in chess.SQUARES:
                    other_piece = board.piece_at(other_square)
                    if not other_piece or other_piece.color != turn:
                        continue

                    # Queen, rook, bishop can deliver discovered attack
                    if other_piece.piece_type not in [chess.QUEEN, chess.ROOK, chess.BISHOP]:
                        continue

                    # Check if piece is between other_piece and valuable target
                    if self._is_between(square, other_square, king_square):
                        # Potential discovered attack
                        severity = 'winning'

                        discoveries.append(TacticalMotif(
                            pattern=TacticalPattern.DISCOVERY,
                            piece=piece,
                            piece_square=square,
                            target_squares=[king_square],
                            target_pieces=[board.piece_at(king_square)],
                            severity=severity,
                            description=self._describe_discovery(piece, square, other_piece, other_square, 'king')
                        ))

        return discoveries

    def detect_overloading(self, board: chess.Board) -> List[TacticalMotif]:
        """
        Detect overloaded pieces (piece defending multiple important targets).

        An overloaded piece is defending multiple important pieces or squares,
        making it vulnerable to deflection tactics.

        Args:
            board: chess Board object

        Returns:
            List of overload motifs
        """
        overloads = []
        turn = board.turn

        # Check opponent's pieces for overload
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece or piece.color == turn:
                continue

            # Count how many valuable pieces this piece defends
            defended_value = 0
            defended_count = 0

            for target_sq in chess.SQUARES:
                target = board.piece_at(target_sq)
                if not target or target.color != piece.color:
                    continue

                # Check if piece defends target
                if board.is_attacked_by(not turn, target_sq):
                    # Actually, we need to check if this specific piece defends the target
                    # For now, use simple heuristic: piece is valuable and in active position
                    if target.piece_type in [chess.QUEEN, chess.ROOK]:
                        defended_value += self.PIECE_VALUES[target.piece_type]
                        defended_count += 1

            # If defending multiple valuable targets, it's overloaded
            if defended_count >= 2 and defended_value >= 6:
                overloads.append(TacticalMotif(
                    pattern=TacticalPattern.OVERLOAD,
                    piece=piece,
                    piece_square=square,
                    target_squares=[],
                    target_pieces=[],
                    severity='positional',
                    description=f"Overloaded {chess.piece_name(piece.piece_type)} at {chess.square_name(square)} defending multiple targets"
                ))

        return overloads

    def _is_aligned(self, sq1: chess.Square, sq2: chess.Square) -> bool:
        """Check if two squares are on the same rank, file, or diagonal"""
        rank1, file1 = chess.square_rank(sq1), chess.square_file(sq1)
        rank2, file2 = chess.square_rank(sq2), chess.square_file(sq2)

        return (rank1 == rank2 or  # Same rank
                file1 == file2 or  # Same file
                abs(rank1 - rank2) == abs(file1 - file2))  # Same diagonal

    def _get_direction(self, from_sq: chess.Square, to_sq: chess.Square) -> Optional[Tuple[int, int]]:
        """Get direction vector from one square to another (if aligned)"""
        rank1, file1 = chess.square_rank(from_sq), chess.square_file(from_sq)
        rank2, file2 = chess.square_rank(to_sq), chess.square_file(to_sq)

        dr = rank2 - rank1
        df = file2 - file1

        # Normalize to unit direction
        if dr == 0 and df == 0:
            return None

        if dr != 0:
            dr = dr // abs(dr)
        if df != 0:
            df = df // abs(df)

        # Check if aligned
        if not self._is_aligned(from_sq, to_sq):
            return None

        return (dr, df)

    def _step_square(self, square: chess.Square, direction: Tuple[int, int]) -> Optional[chess.Square]:
        """Move one step in direction from square"""
        rank = chess.square_rank(square) + direction[0]
        file = chess.square_file(square) + direction[1]

        if 0 <= rank < 8 and 0 <= file < 8:
            return chess.square(file, rank)
        return None

    def _is_between(self, middle: chess.Square, start: chess.Square, end: chess.Square) -> bool:
        """Check if middle square is between start and end on a line"""
        if not (self._is_aligned(start, middle) and self._is_aligned(middle, end)):
            return False

        # Check if middle is between start and end
        dist_start = self._distance(start, middle)
        dist_end = self._distance(middle, end)
        dist_total = self._distance(start, end)

        return abs(dist_start + dist_end - dist_total) < 0.01

    def _distance(self, sq1: chess.Square, sq2: chess.Square) -> float:
        """Calculate distance between two squares"""
        rank1, file1 = chess.square_rank(sq1), chess.square_file(sq1)
        rank2, file2 = chess.square_rank(sq2), chess.square_file(sq2)

        return ((rank2 - rank1) ** 2 + (file2 - file1) ** 2) ** 0.5

    def _describe_fork(self, piece: chess.Piece, square: chess.Square, targets: List[Tuple[chess.Square, chess.Piece]]) -> str:
        """Generate description for fork"""
        piece_name = chess.piece_name(piece.piece_type)
        square_name = chess.square_name(square)
        target_names = [f"{chess.piece_name(t.piece_type)} on {chess.square_name(s)}" for s, t in targets]
        return f"{piece_name.capitalize()} fork from {square_name} attacks {', '.join(target_names[:2])}"

    def _describe_pin(self, attacker: chess.Piece, att_sq: chess.Square, pinned: chess.Piece, pin_sq: chess.Square) -> str:
        """Generate description for pin"""
        att_name = chess.piece_name(attacker.piece_type)
        pin_name = chess.piece_name(pinned.piece_type)
        return f"{att_name.capitalize()} pins {pin_name} on {chess.square_name(pin_sq)}"

    def _describe_skewer(self, piece: chess.Piece, piece_sq: chess.Square, valuable: chess.Piece, val_sq: chess.Square,
                        less_valuable: chess.Piece, less_sq: chess.Square) -> str:
        """Generate description for skewer"""
        piece_name = chess.piece_name(piece.piece_type)
        val_name = chess.piece_name(valuable.piece_type)
        less_name = chess.piece_name(less_valuable.piece_type)
        return f"{piece_name.capitalize()} skewers {val_name} on {chess.square_name(val_sq)}, exposing {less_name}"

    def _describe_discovery(self, mover: chess.Piece, move_sq: chess.Square, attacker: chess.Piece, att_sq: chess.Square, target: str) -> str:
        """Generate description for discovered attack"""
        move_name = chess.piece_name(mover.piece_type)
        att_name = chess.piece_name(attacker.piece_type)
        return f"Discovered attack: moving {move_name} from {chess.square_name(move_sq)} reveals {att_name} attack on {target}"

    def get_summary(self, motifs: List[TacticalMotif]) -> Dict:
        """Get summary statistics of detected motifs"""
        summary = {
            'total': len(motifs),
            'by_pattern': {},
            'by_severity': {'winning': 0, 'material': 0, 'positional': 0}
        }

        for motif in motifs:
            pattern = motif.pattern.value
            summary['by_pattern'][pattern] = summary['by_pattern'].get(pattern, 0) + 1
            summary['by_severity'][motif.severity] += 1

        return summary
