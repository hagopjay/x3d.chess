"""Opening positions derived from legal SAN prefixes, not hand-copied FENs.

The browser book uses the same prefixes; a cross-language test compares FENs,
including active color, castling, en-passant and move counters. `moves_played`
is retained as a compatibility field and explicitly counts plies.
"""
from dataclasses import dataclass
import random
import chess


@dataclass(frozen=True)
class OpeningPosition:
    name: str
    fen: str
    weight: float
    moves_played: int
    description: str
    moves: tuple[str, ...] = ()

    def board(self) -> chess.Board:
        if not self.moves:
            return chess.Board(self.fen)
        board = chess.Board()
        for move in self.moves:
            board.push_san(move)
        if board.fen() != self.fen:
            raise ValueError("Opening prefix disagrees with its FEN")
        return board


def _opening(name: str, weight: float, moves: str, description: str) -> OpeningPosition:
    prefix = tuple(moves.split())
    board = chess.Board()
    for move in prefix:
        board.push_san(move)
    return OpeningPosition(name, board.fen(), weight, len(prefix), description, prefix)


OPENING_BOOK: dict[str, OpeningPosition] = {
    "italian": _opening("Italian Game", 1.0, "e4 e5 Nf3 Nc6 Bc4", "Italian after 1.e4 e5 2.Nf3 Nc6 3.Bc4"),
    "ruy_lopez": _opening("Ruy Lopez", 1.2, "e4 e5 Nf3 Nc6 Bb5", "Spanish after 1.e4 e5 2.Nf3 Nc6 3.Bb5"),
    "sicilian": _opening("Sicilian Defense", 1.5, "e4 c5", "Sicilian after 1.e4 c5"),
    "french": _opening("French Defense", 0.9, "e4 e6 d4 d5 e5", "French Advance after 1.e4 e6 2.d4 d5 3.e5"),
    "caro_kann": _opening("Caro-Kann Defense", 0.8, "e4 c6", "Caro-Kann after 1.e4 c6"),
    "queens_gambit": _opening("Queen's Gambit", 1.1, "d4 d5 c4", "Queen's Gambit after 1.d4 d5 2.c4"),
    "kings_indian": _opening("King's Indian Defense", 1.0, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6", "KID after 1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6"),
    "english": _opening("English Opening", 0.7, "c4", "English after 1.c4"),
    "reti": _opening("Reti Opening", 0.6, "Nf3", "Reti after 1.Nf3"),
    "scotch": _opening("Scotch Game", 0.8, "e4 e5 Nf3 Nc6 d4", "Scotch after 1.e4 e5 2.Nf3 Nc6 3.d4"),
}


def get_random_opening() -> OpeningPosition:
    return get_opening_variety(1)[0]


def get_opening_by_name(name: str) -> OpeningPosition:
    for opening in OPENING_BOOK.values():
        if opening.name.lower() == name.lower():
            return opening
    raise KeyError(f"Opening '{name}' not found")


def get_opening_variety(count: int = 10) -> list[OpeningPosition]:
    values = list(OPENING_BOOK.values())
    return random.choices(values, weights=[o.weight for o in values], k=count)


def list_openings() -> list[dict]:
    return [{"name": o.name, "description": o.description, "moves_played": o.moves_played,
             "plies": len(o.moves), "moves": list(o.moves), "weight": o.weight}
            for o in OPENING_BOOK.values()]
