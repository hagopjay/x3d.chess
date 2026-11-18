"""Bounded, conservative tactical geometry, not a search or winning-move oracle.

Static motifs inspect both colors. Discovery records require an actual legal
move for the side to move. Geometric attacks and legal moves remain distinct:
pinned pieces still contribute to FIDE attack maps, even when not movable.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import chess


class TacticalPattern(Enum):
    FORK = "fork"
    PIN = "pin"
    SKEWER = "skewer"
    DISCOVERY = "discovery"
    OVERLOAD = "overload"  # Reserved; no proof-free overload heuristic is emitted.


@dataclass
class TacticalMotif:
    pattern: TacticalPattern
    piece: chess.Piece
    piece_square: chess.Square
    target_squares: List[chess.Square]
    target_pieces: List[chess.Piece]
    severity: str
    description: str
    status: str = "geometric_candidate"
    witness_moves: List[str] = field(default_factory=list)
    revealed_square: Optional[chess.Square] = None

    def to_dict(self):
        return {
            "pattern": self.pattern.value,
            "piece": chess.piece_name(self.piece.piece_type),
            "piece_color": "white" if self.piece.color else "black",
            "piece_square": chess.square_name(self.piece_square),
            "target_squares": [chess.square_name(sq) for sq in self.target_squares],
            "target_pieces": [chess.piece_name(p.piece_type) for p in self.target_pieces],
            "severity": self.severity,
            "description": self.description,
            "status": self.status,
            "witness_moves": self.witness_moves,
            "revealed_square": chess.square_name(self.revealed_square) if self.revealed_square is not None else None,
        }


DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1),
        (1, 1), (1, -1), (-1, 1), (-1, -1))
SLIDER_DIRS = {chess.ROOK: DIRS[:4], chess.BISHOP: DIRS[4:], chess.QUEEN: DIRS}
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5,
          chess.QUEEN: 9, chess.KING: 100}


def ray(square, direction):
    df, dr = direction
    f, r = chess.square_file(square) + df, chess.square_rank(square) + dr
    while 0 <= f < 8 and 0 <= r < 8:
        yield chess.square(f, r)
        f += df; r += dr


def absolute_pins(board):
    """(pinner, constrained piece, king), checked in a deterministic order."""
    out = []
    for king in chess.SQUARES:
        royal = board.piece_at(king)
        if not royal or royal.piece_type != chess.KING:
            continue
        for direction in DIRS:
            blocker = None
            for sq in ray(king, direction):
                p = board.piece_at(sq)
                if not p:
                    continue
                if blocker is None:
                    if p.color != royal.color:
                        break
                    blocker = sq
                else:
                    if p.color != royal.color and direction in SLIDER_DIRS.get(p.piece_type, ()):
                        out.append((sq, blocker, king))
                    break
    return sorted(out)


class TacticalDetector:
    PIECE_VALUES = VALUES

    def detect_all_patterns(self, board):
        return (self.detect_forks(board) + self.detect_pins(board) +
                self.detect_skewers(board) + self.detect_discoveries(board))

    def detect_forks(self, board):
        """Existing multi-target attack candidates, excluding off-ray pinned threats.

        Targets are kings, queens and rooks. This deliberately bounded subset
        does not claim that either capture is legal, safe or winning.
        """
        pins = {blocked: chess.SquareSet(chess.between(king, pinner) | chess.BB_SQUARES[pinner])
                for pinner, blocked, king in absolute_pins(board)}
        out = []
        for sq in chess.SQUARES:
            p = board.piece_at(sq)
            if not p or p.piece_type == chess.KING:
                continue
            hit = [t for t in board.attacks(sq)
                   if board.piece_at(t) and board.piece_at(t).color != p.color
                   and board.piece_at(t).piece_type in (chess.QUEEN, chess.ROOK, chess.KING)
                   and (sq not in pins or t in pins[sq])]
            if len(hit) >= 2:
                targets = [board.piece_at(t) for t in hit]
                names = [f"{chess.piece_name(t.piece_type)} on {chess.square_name(s)}" for s,t in zip(hit,targets)]
                out.append(TacticalMotif(TacticalPattern.FORK,p,sq,hit,targets,"candidate",
                    f"{chess.piece_name(p.piece_type).capitalize()} fork geometry from {chess.square_name(sq)} attacks {', '.join(names[:2])}; no material win is proven"))
        return out

    def detect_pins(self, board):
        out = []
        for attacker, blocked, king in absolute_pins(board):
            p, target, royal = board.piece_at(attacker), board.piece_at(blocked), board.piece_at(king)
            out.append(TacticalMotif(TacticalPattern.PIN,p,attacker,[blocked,king],[target,royal],"candidate",
                f"{chess.piece_name(p.piece_type).capitalize()} on {chess.square_name(attacker)} absolutely pins {chess.piece_name(target.piece_type)} on {chess.square_name(blocked)} to king on {chess.square_name(king)}",
                status="absolute_pin"))
        return out

    def detect_skewers(self, board):
        out = []
        for sq in chess.SQUARES:
            p = board.piece_at(sq)
            if not p or p.piece_type not in SLIDER_DIRS:
                continue
            pairs = []
            for direction in SLIDER_DIRS[p.piece_type]:
                occupied = [t for t in ray(sq,direction) if board.piece_at(t)]
                if len(occupied) < 2:
                    continue
                front, rear = occupied[:2]
                a,b = board.piece_at(front),board.piece_at(rear)
                if a.color != p.color and b.color != p.color and a.piece_type in (chess.KING,chess.QUEEN) and b.piece_type in (chess.QUEEN,chess.ROOK,chess.BISHOP,chess.KNIGHT) and VALUES[b.piece_type] < VALUES[a.piece_type]:
                    pairs.append((front,rear))
            for front,rear in sorted(pairs):
                a,b = board.piece_at(front),board.piece_at(rear)
                out.append(TacticalMotif(TacticalPattern.SKEWER,p,sq,[front,rear],[a,b],"candidate",
                    f"{chess.piece_name(p.piece_type).capitalize()} skewer geometry from {chess.square_name(sq)} aligns {chess.piece_name(a.piece_type)} on {chess.square_name(front)} with {chess.piece_name(b.piece_type)} on {chess.square_name(rear)}; replies are not searched"))
        return out

    def detect_discoveries(self, board):
        """Legal moves that reveal an unmoved friendly slider's check.

        Includes ordinary one-blocker rays and en-passant's two-square removal.
        The witness does not establish best play, a forced sequence or a win.
        """
        color, king = board.turn, board.king(not board.turn)
        if king is None:
            return []
        candidates = {}
        for slider in chess.SQUARES:
            p = board.piece_at(slider)
            if not p or p.color != color or p.piece_type not in SLIDER_DIRS:
                continue
            for direction in SLIDER_DIRS[p.piece_type]:
                between = []
                for sq in ray(slider,direction):
                    if sq == king:
                        if len(between)==1 and board.piece_at(between[0]).color==color:
                            candidates.setdefault(between[0],set()).add(slider)
                        break
                    if board.piece_at(sq):
                        between.append(sq)
                        if len(between)>1:
                            break
        if not candidates and board.ep_square is None:
            return []
        found = {}
        for move in list(board.legal_moves):
            sliders = set(candidates.get(move.from_square, ()))
            if board.is_en_passant(move):
                sliders.update(s for s in chess.SQUARES if board.piece_at(s) and board.piece_at(s).color==color and board.piece_at(s).piece_type in SLIDER_DIRS)
            if not sliders:
                continue
            after = board.copy(stack=False);after.push(move)
            for slider in sorted(sliders):
                if slider==move.from_square or king in board.attacks(slider) or king not in after.attacks(slider):
                    continue
                key=(move.from_square,slider)
                found.setdefault(key,[]).append(move.uci())
        out=[]
        for (mover,slider),moves in sorted(found.items()):
            p,attacker=board.piece_at(mover),board.piece_at(slider)
            out.append(TacticalMotif(TacticalPattern.DISCOVERY,p,mover,[king],[board.piece_at(king)],"candidate",
                f"Legal discovered-check candidate: moving {chess.piece_name(p.piece_type)} from {chess.square_name(mover)} can reveal {chess.piece_name(attacker.piece_type)} on {chess.square_name(slider)} against king on {chess.square_name(king)}",
                status="legal_move_witness",witness_moves=sorted(moves),revealed_square=slider))
        return out

    def detect_overloading(self, board):
        """Reserved for a future concrete deflection/search witness.

        Defending several pieces is not by itself proof of overloading.
        """
        return []
