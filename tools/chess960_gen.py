#!/usr/bin/env python3
"""Independent Chess960 oracle: python-chess (chess960=True) plays castling-biased random games.

Writes JSON for tools/chess960-test.mjs: all 960 start positions, plus per-ply legal-move sets (UCI_Chess960
encoding, castling = king takes own rook), SANs, Shredder-FENs and terminal flags. Deterministic for a given seed.
"""
import argparse, json, random, sys
import chess

def flags(b):
    return {"checkmate": b.is_checkmate(), "stalemate": b.is_stalemate(), "insufficient": b.is_insufficient_material(),
            "fifty": b.is_fifty_moves(), "threefold": b.is_repetition(3), "check": b.is_check()}

def game(pos, rng, cap):
    b = chess.Board.from_chess960_pos(pos)
    out = {"id": pos, "start": b.shredder_fen(), "plies": []}
    while len(out["plies"]) < cap and not b.is_game_over(claim_draw=False):
        legal = sorted(m.uci() if False else b.uci(m, chess960=True) for m in b.legal_moves)
        castles = [m for m in b.legal_moves if b.is_castling(m)]
        caps = [m for m in b.legal_moves if b.is_capture(m)]
        r = rng.random()
        m = rng.choice(castles) if castles and r < 0.55 else rng.choice(caps) if caps and r < 0.75 else rng.choice(list(b.legal_moves))
        san, uci, castle = b.san(m), b.uci(m, chess960=True), b.is_castling(m)
        b.push(m)
        out["plies"].append({"legal": legal, "uci": uci, "san": san, "castle": castle, "fen": b.shredder_fen(), **flags(b)})
    return out

def main():
    p = argparse.ArgumentParser(); p.add_argument("--games", type=int, default=260); p.add_argument("--plies", type=int, default=100)
    p.add_argument("--seed", type=int, default=960); p.add_argument("--stdout", action="store_true")
    a = p.parse_args(); rng = random.Random(a.seed)
    starts = [{"id": i, "fen": chess.Board.from_chess960_pos(i).shredder_fen()} for i in range(960)]
    ids = [518] + [rng.randrange(960) for _ in range(a.games - 1)]
    json.dump({"python_chess": chess.__version__, "starts": starts, "games": [game(i, rng, a.plies) for i in ids]}, sys.stdout)

if __name__ == "__main__":
    main()
