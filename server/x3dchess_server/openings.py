"""
Opening Book Module - Collection of opening positions for variety
"""
from typing import Dict, List, Any
from dataclasses import dataclass


@dataclass
class OpeningPosition:
    """Represents a chess opening position"""
    name: str
    fen: str
    weight: float  # For randomization (higher = more likely)
    moves_played: int  # How many moves into the opening
    description: str


# Opening book with 10 distinct openings
OPENING_BOOK: Dict[str, OpeningPosition] = {
    "italian": OpeningPosition(
        name="Italian Game",
        fen="r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3",
        weight=1.0,
        moves_played=3,
        description="Classical Italian after 1.e4 e5 2.Nf3 Nc6 3.Bc4"
    ),
    "ruy_lopez": OpeningPosition(
        name="Ruy Lopez",
        fen="r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3",
        weight=1.2,
        moves_played=3,
        description="Spanish Opening after 1.e4 e5 2.Nf3 Nc6 3.Bb5"
    ),
    "sicilian": OpeningPosition(
        name="Sicilian Defense",
        fen="rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
        weight=1.5,
        moves_played=2,
        description="Open Sicilian after 1.e4 c5"
    ),
    "french": OpeningPosition(
        name="French Defense",
        fen="rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3",
        weight=0.9,
        moves_played=3,
        description="French Advance after 1.e4 e6 2.d4 d5 3.e5"
    ),
    "caro_kann": OpeningPosition(
        name="Caro-Kann Defense",
        fen="rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
        weight=0.8,
        moves_played=2,
        description="Caro-Kann after 1.e4 c6"
    ),
    "queens_gambit": OpeningPosition(
        name="Queen's Gambit",
        fen="rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 1",
        weight=1.1,
        moves_played=2,
        description="Queen's Gambit after 1.d4 d5 2.c4"
    ),
    "kings_indian": OpeningPosition(
        name="King's Indian Defense",
        fen="rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4",
        weight=1.0,
        moves_played=4,
        description="KID after 1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6"
    ),
    "english": OpeningPosition(
        name="English Opening",
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        weight=0.7,
        moves_played=0,
        description="English Opening (starting position)"
    ),
    "reti": OpeningPosition(
        name="Reti Opening",
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        weight=0.6,
        moves_played=0,
        description="Reti Opening (starting position)"
    ),
    "scotch": OpeningPosition(
        name="Scotch Game",
        fen="r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3",
        weight=0.8,
        moves_played=3,
        description="Scotch Game after 1.e4 e5 2.Nf3 Nc6 3.d4"
    )
}


def get_random_opening() -> OpeningPosition:
    """
    Select a random opening based on weights

    Returns:
        OpeningPosition: The selected opening
    """
    import random

    openings = list(OPENING_BOOK.values())
    weights = [opening.weight for opening in openings]

    return random.choices(openings, weights=weights, k=1)[0]


def get_opening_by_name(name: str) -> OpeningPosition:
    """
    Get a specific opening by name

    Args:
        name: The name of the opening

    Returns:
        OpeningPosition: The opening if found

    Raises:
        KeyError: If opening not found
    """
    for opening in OPENING_BOOK.values():
        if opening.name.lower() == name.lower():
            return opening

    raise KeyError(f"Opening '{name}' not found")


def get_opening_variety(count: int = 10) -> List[OpeningPosition]:
    """
    Get a variety of openings for multiple games

    Args:
        count: Number of openings to return

    Returns:
        List of OpeningPosition objects
    """
    import random

    openings = list(OPENING_BOOK.values())
    weights = [opening.weight for opening in openings]

    return random.choices(openings, weights=weights, k=count)


def list_openings() -> List[Dict[str, Any]]:
    """
    Get a list of all available openings

    Returns:
        List of dictionaries with opening info
    """
    return [
        {
            "name": opening.name,
            "description": opening.description,
            "moves_played": opening.moves_played,
            "weight": opening.weight
        }
        for opening in OPENING_BOOK.values()
    ]
