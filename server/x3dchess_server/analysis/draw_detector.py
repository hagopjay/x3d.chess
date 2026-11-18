"""Draw conditions delegated to the rules library, with claims kept explicit.

A FEN list cannot recover move history or establish legal repetition. Preserve
Board.move_stack (or replay a legal PGN) for repetition/announced-move claims.
The live GameManager has its own documented auto-claim adjudication policy.
"""
from dataclasses import dataclass
from enum import Enum
import chess


class DrawType(Enum):
    THREEFOLD_REPETITION='threefold_repetition'
    FIFTY_MOVE_RULE='fifty_move_rule'
    FIVEFOLD_REPETITION='fivefold_repetition'
    SEVENTYFIVE_MOVE_RULE='seventyfive_move_rule'
    INSUFFICIENT_MATERIAL='insufficient_material'
    STALEMATE='stalemate'
    AGREEMENT='agreement'


@dataclass
class DrawInfo:
    draw_type: DrawType
    description: str
    move_number: int
    fen: str
    additional_info: dict = None
    def to_dict(self):
        return {'draw_type':self.draw_type.value,'description':self.description,
                'move_number':self.move_number,'fen':self.fen,'additional_info':self.additional_info or {}}


class DrawDetector:
    def detect_draw(self,board,position_history=None,*,claim_draw=False):
        """Automatic draws by default; explicit claim_draw also adjudicates claims.

        position_history is a legacy parameter and is not evidence of repetition.
        Checkmate precedence and prospective claims use python-chess rules.
        """
        outcome=board.outcome(claim_draw=claim_draw)
        if outcome is None or outcome.winner is not None:return None
        kinds={chess.Termination.STALEMATE:DrawType.STALEMATE,
               chess.Termination.INSUFFICIENT_MATERIAL:DrawType.INSUFFICIENT_MATERIAL,
               chess.Termination.FIVEFOLD_REPETITION:DrawType.FIVEFOLD_REPETITION,
               chess.Termination.SEVENTYFIVE_MOVES:DrawType.SEVENTYFIVE_MOVE_RULE,
               chess.Termination.THREEFOLD_REPETITION:DrawType.THREEFOLD_REPETITION,
               chess.Termination.FIFTY_MOVES:DrawType.FIFTY_MOVE_RULE}
        kind=kinds.get(outcome.termination)
        if kind is None:return None
        claimed=kind in (DrawType.THREEFOLD_REPETITION,DrawType.FIFTY_MOVE_RULE)
        return DrawInfo(kind,('Claim adjudicated: ' if claimed else 'Automatic draw: ')+kind.value.replace('_',' '),
                        len(board.move_stack),board.fen(),{'claim_adjudicated':claimed,'automatic':not claimed})

    def _is_stalemate(self,board):return board.is_stalemate()
    def _check_insufficient_material(self,board):
        return 'Insufficient material under python-chess rules' if board.is_insufficient_material() else None
    def _count_material(self,board,color):
        return {chess.piece_symbol(t).upper():len(board.pieces(t,color)) for t in chess.PIECE_TYPES if board.pieces(t,color)}
    def _find_piece_square(self,board,piece_type,color):return next(iter(board.pieces(piece_type,color)),None)
    def _check_threefold_repetition(self,board,position_history=None):
        if board.outcome(claim_draw=False) is not None or not board.can_claim_threefold_repetition():return None
        return DrawInfo(DrawType.THREEFOLD_REPETITION,'Threefold repetition claim available now or by an announced legal move',len(board.move_stack),board.fen(),{'claimable':True})
    def _check_fifty_move_rule(self,board):
        if board.outcome(claim_draw=False) is not None or not board.can_claim_fifty_moves():return None
        return DrawInfo(DrawType.FIFTY_MOVE_RULE,'Fifty-move claim available now or by an announced legal move',len(board.move_stack),board.fen(),{'claimable':True,'halfmove_clock':board.halfmove_clock})
    def can_claim_draw(self,board,position_history=None):
        terminal=board.outcome(claim_draw=False) is not None
        return {'threefold_repetition':not terminal and board.can_claim_threefold_repetition(),
                'fifty_move_rule':not terminal and board.can_claim_fifty_moves(),
                'insufficient_material':board.is_insufficient_material(),'stalemate':board.is_stalemate(),
                'fivefold_repetition':board.is_fivefold_repetition(),'seventyfive_move_rule':board.is_seventyfive_moves()}
    def get_material_draw_indicator(self,board):
        """Legacy material-only indicator, uncalibrated and not a probability."""
        values={chess.QUEEN:9,chess.ROOK:5,chess.BISHOP:3,chess.KNIGHT:3,chess.PAWN:1,chess.KING:0}
        material=sum(values[p.piece_type] for p in board.piece_map().values())
        return .8 if material<=3 else .4 if material<=10 else .2 if material<=20 else .1
    def get_draw_probability(self,board):
        """Compatibility alias only: returns an uncalibrated material indicator."""
        return self.get_material_draw_indicator(board)
    def get_position_hash(self,board):
        """Repetition key includes turn, castling and legally available EP rights.

        This human-readable key is not a cryptographic hash or history proof.
        """
        return ' '.join(board.fen(en_passant='legal').split()[:4])
