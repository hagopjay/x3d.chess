"""
Bifurcation Detector - Critical moment detection in chess games
Identifies sharp eval changes, blunders, mistakes, and game phase transitions
"""
from typing import List, Dict, Tuple
from dataclasses import dataclass
import chess


@dataclass
class CriticalMoment:
    """Represents a critical moment in a game"""
    move_number: int
    move: str
    severity: str  # 'blunder', 'mistake', 'inaccuracy', 'sharp_change', 'phase_transition'
    eval_before: float
    eval_after: float
    eval_change: float
    description: str
    fen: str


class BifurcationDetector:
    """Detects critical moments and bifurcation points in games"""

    # Thresholds for categorizing move quality
    BLUNDER_THRESHOLD = 1.0
    MISTAKE_THRESHOLD = 0.5
    INACCURACY_THRESHOLD = 0.2
    SHARP_CHANGE_THRESHOLD = 0.5

    # Piece values for material calculation
    PIECE_VALUES = {
        chess.PAWN: 1,
        chess.KNIGHT: 3,
        chess.BISHOP: 3,
        chess.ROOK: 5,
        chess.QUEEN: 9,
        chess.KING: 0
    }

    def __init__(self):
        self.eval_history: List[Tuple[int, float]] = []  # (move_number, eval)
        self.move_history: List[Tuple[int, str]] = []  # (move_number, move_san)
        self.fen_history: List[Tuple[int, str]] = []  # (move_number, fen)

    def add_position(self, move_number: int, eval_score: float, move: str, fen: str):
        """Add a position to the tracking history"""
        self.eval_history.append((move_number, eval_score))
        self.move_history.append((move_number, move))
        self.fen_history.append((move_number, fen))

    def detect_critical_moments(self) -> List[CriticalMoment]:
        """Analyze game history and return all critical moments"""
        moments = []

        if len(self.eval_history) < 2:
            return moments

        for i in range(1, len(self.eval_history)):
            move_num, eval_after = self.eval_history[i]
            prev_move_num, eval_before = self.eval_history[i - 1]

            if i - 1 < len(self.move_history):
                _, move = self.move_history[i - 1]
            else:
                move = "unknown"

            if i - 1 < len(self.fen_history):
                _, fen = self.fen_history[i - 1]
            else:
                fen = ""

            eval_change = abs(eval_after - eval_before)

            # Detect blunders
            if eval_change >= self.BLUNDER_THRESHOLD:
                moments.append(CriticalMoment(
                    move_number=move_num,
                    move=move,
                    severity='blunder',
                    eval_before=eval_before,
                    eval_after=eval_after,
                    eval_change=eval_change,
                    description=self._describe_blunder(eval_before, eval_after, move),
                    fen=fen
                ))

            # Detect mistakes (not already flagged as blunder)
            elif eval_change >= self.MISTAKE_THRESHOLD:
                moments.append(CriticalMoment(
                    move_number=move_num,
                    move=move,
                    severity='mistake',
                    eval_before=eval_before,
                    eval_after=eval_after,
                    eval_change=eval_change,
                    description=self._describe_mistake(eval_before, eval_after, move),
                    fen=fen
                ))

            # Detect inaccuracies (not already flagged)
            elif eval_change >= self.INACCURACY_THRESHOLD:
                moments.append(CriticalMoment(
                    move_number=move_num,
                    move=move,
                    severity='inaccuracy',
                    eval_before=eval_before,
                    eval_after=eval_after,
                    eval_change=eval_change,
                    description=self._describe_inaccuracy(eval_before, eval_after, move),
                    fen=fen
                ))

            # Detect sharp eval changes (can coexist with above)
            if eval_change >= self.SHARP_CHANGE_THRESHOLD:
                # Only add if not already added as blunder/mistake/inaccuracy
                if not any(m.move_number == move_num and m.severity in ['blunder', 'mistake', 'inaccuracy'] for m in moments):
                    moments.append(CriticalMoment(
                        move_number=move_num,
                        move=move,
                        severity='sharp_change',
                        eval_before=eval_before,
                        eval_after=eval_after,
                        eval_change=eval_change,
                        description=self._describe_sharp_change(eval_before, eval_after, move),
                        fen=fen
                    ))

            # Detect phase transitions
            if i >= 2:  # Need at least 3 positions to detect phase
                phase_moment = self._detect_phase_transition(i)
                if phase_moment:
                    moments.append(phase_moment)

        return sorted(moments, key=lambda m: m.move_number)

    def _detect_phase_transition(self, current_idx: int) -> CriticalMoment:
        """Detect if current move transitions to a different game phase"""
        if current_idx < 2:
            return None

        # Get material counts for last 3 positions
        materials = []
        for i in range(max(0, current_idx - 2), current_idx + 1):
            if i < len(self.fen_history):
                _, fen = self.fen_history[i]
                board = chess.Board(fen)
                material = self._calculate_material(board)
                materials.append(material)

        if len(materials) < 3:
            return None

        # Check for significant material exchange (transition to endgame)
        material_loss = materials[0] - materials[-1]
        total_material = materials[0]

        if total_material > 0 and material_loss / total_material > 0.15:  # Lost 15%+ material
            move_num, eval_after = self.eval_history[current_idx]
            _, move = self.move_history[current_idx - 1] if current_idx - 1 < len(self.move_history) else ("", "")
            _, fen = self.fen_history[current_idx - 1] if current_idx - 1 < len(self.fen_history) else ("", "")

            # Determine phase
            if materials[-1] < 20:  # Low material = endgame
                phase = "endgame"
            elif materials[-1] < 30:  # Medium material = middlegame
                phase = "middlegame"
            else:
                phase = "complex"

            return CriticalMoment(
                move_number=move_num,
                move=move,
                severity='phase_transition',
                eval_before=self.eval_history[current_idx - 1][1],
                eval_after=eval_after,
                eval_change=abs(self.eval_history[current_idx][1] - self.eval_history[current_idx - 1][1]),
                description=f"Phase transition to {phase} after material exchange ({material_loss:.1f} points)",
                fen=fen
            )

        return None

    def _calculate_material(self, board: chess.Board) -> int:
        """Calculate total material on board"""
        material = 0
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                material += self.PIECE_VALUES.get(piece.piece_type, 0)
        return material

    def _describe_blunder(self, eval_before: float, eval_after: float, move: str) -> str:
        """Generate description for blunder"""
        perspective = "White" if eval_before > 0 else "Black"
        lost = abs(eval_after - eval_before)
        return f"Blunder by {perspective}: {move} loses {lost:.2f} points"

    def _describe_mistake(self, eval_before: float, eval_after: float, move: str) -> str:
        """Generate description for mistake"""
        perspective = "White" if eval_before > 0 else "Black"
        lost = abs(eval_after - eval_before)
        return f"Mistake by {perspective}: {move} loses {lost:.2f} points"

    def _describe_inaccuracy(self, eval_before: float, eval_after: float, move: str) -> str:
        """Generate description for inaccuracy"""
        return f"Inaccuracy: {move} slightly worsens position"

    def _describe_sharp_change(self, eval_before: float, eval_after: float, move: str) -> str:
        """Generate description for sharp eval change"""
        change = eval_after - eval_before
        if change > 0:
            return f"Sharp swing: {move} shifts advantage to White by {abs(change):.2f}"
        else:
            return f"Sharp swing: {move} shifts advantage to Black by {abs(change):.2f}"

    def reset(self):
        """Clear all history for new game"""
        self.eval_history.clear()
        self.move_history.clear()
        self.fen_history.clear()

    def get_latest_critical_moment(self) -> CriticalMoment:
        """Get the most recent critical moment"""
        moments = self.detect_critical_moments()
        return moments[-1] if moments else None
