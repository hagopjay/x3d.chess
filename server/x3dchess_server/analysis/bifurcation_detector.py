"""Neutral evaluation-swing and material-exchange observations.

These samples are not a centipawn-loss or move-quality analysis: scores at
successive search positions/depths cannot by themselves identify a blunder.
"""
from dataclasses import dataclass
import math
from numbers import Real
from typing import List, Tuple
import chess


@dataclass
class CriticalMoment:
    move_number: int
    move: str
    severity: str
    eval_before: float
    eval_after: float
    eval_change: float
    description: str
    fen: str


class BifurcationDetector:
    LARGE_SWING_THRESHOLD = 1.0
    MEDIUM_SWING_THRESHOLD = 0.5
    SMALL_SWING_THRESHOLD = 0.2
    PIECE_VALUES = {chess.PAWN:1,chess.KNIGHT:3,chess.BISHOP:3,chess.ROOK:5,chess.QUEEN:9,chess.KING:0}

    def __init__(self):
        self.eval_history: List[Tuple[int,float]]=[]
        self.move_history: List[Tuple[int,str]]=[]
        self.fen_history: List[Tuple[int,str]]=[]

    def add_position(self,move_number,eval_score,move,fen):
        if type(move_number) is not int or move_number<0 or isinstance(eval_score,bool) or not isinstance(eval_score,Real) or not math.isfinite(eval_score) or not isinstance(fen,str):
            raise ValueError('Invalid scored-position sample')
        if self.eval_history and move_number<=self.eval_history[-1][0]:
            raise ValueError('Scored plies must strictly increase')
        self.eval_history.append((move_number,float(eval_score)))
        self.move_history.append((move_number,move))
        self.fen_history.append((move_number,fen))

    def detect_critical_moments(self):
        moments=[]
        for i in range(1,len(self.eval_history)):
            ply,after=self.eval_history[i];before=self.eval_history[i-1][1]
            change=abs(after-before)
            severity=('large_swing' if change>=self.LARGE_SWING_THRESHOLD else
                      'medium_swing' if change>=self.MEDIUM_SWING_THRESHOLD else
                      'small_swing' if change>=self.SMALL_SWING_THRESHOLD else None)
            move=self.move_history[i][1];fen=self.fen_history[i][1]
            if severity:
                moments.append(CriticalMoment(ply,move,severity,before,after,change,
                    f"Evaluation swing of {change:.2f} pawns between scored positions; move quality is not established",fen))
            if i>=2:
                materials=[self._material_fen(self.fen_history[j][1]) for j in range(i-2,i+1)]
                loss=materials[0]-materials[-1]
                if materials[0]>0 and loss/materials[0]>.15:
                    moments.append(CriticalMoment(ply,move,'material_exchange',before,after,change,
                        f"Material total fell by {loss:.1f} points over two sample intervals; no exact game-phase boundary is implied",fen))
        return moments

    def _material_fen(self,fen):
        symbols={'p':1,'n':3,'b':3,'r':5,'q':9,'k':0}
        return sum(symbols.get(ch.lower(),0) for ch in fen.split(' ')[0])

    def _calculate_material(self,board):
        return sum(self.PIECE_VALUES[p.piece_type] for p in board.piece_map().values())

    def get_latest_critical_moment(self):
        moments=self.detect_critical_moments()
        return moments[-1] if moments else None

    def reset(self):
        self.eval_history.clear();self.move_history.clear();self.fen_history.clear()
