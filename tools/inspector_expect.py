#!/usr/bin/env python3
"""Generate independent python-chess expectations for tools/inspector-test.mjs.

Seed is fixed; output is deterministic JSON on stdout (or --out). For each of 100
reachable positions and each of 64 squares it records, using only python-chess:
  moves    : legal UCI moves from the square (side to move only) with derived flags
  att      : geometric attackers per colour (board.attackers)
  legal    : for each attacker, whether from->square would be legal (turn flipped,
             null for an own-piece target or a pawn diagonal onto an empty non-ep square;
             en passant right dropped when the attacker is not the side to move;
             null when the target holds the enemy king)
  pinned   : absolute pin flag for each occupied square (board.is_pinned)
  enemy    : whether the square is attacked by the colour opposite its occupant
             (opposite of the side to move when empty)
The JS test never copies these values from the JS module.
"""
import argparse, json, random, sys
import chess

SEED = 20261117
COUNT = 100


def sqn(s):
    return chess.square_name(s)


def flags(board, m):
    out = []
    if board.is_capture(m): out.append('capture')
    if board.is_en_passant(m): out.append('en_passant')
    if board.is_kingside_castling(m): out.append('castle_k')
    if board.is_queenside_castling(m): out.append('castle_q')
    if m.promotion: out.append('promotion')
    return out


def pick(board, rng):
    moves = list(board.legal_moves)
    w = []
    for m in moves:
        x = 1.0
        if board.is_castling(m): x = 25.0
        elif board.is_en_passant(m): x = 40.0
        elif m.promotion: x = 12.0
        elif board.is_capture(m): x = 2.0
        elif board.piece_type_at(m.from_square) == chess.PAWN: x = 1.6
        w.append(x)
    return rng.choices(moves, weights=w)[0]


FEATURES = ('ep', 'castle', 'check', 'promotion', 'any')


def wanted(board, feature):
    if feature == 'ep': return board.ep_square is not None and any(board.is_en_passant(m) for m in board.legal_moves)
    if feature == 'castle': return any(board.is_castling(m) for m in board.legal_moves)
    if feature == 'check': return board.is_check()
    if feature == 'promotion': return any(m.promotion for m in board.legal_moves)
    return True


def positions(rng):
    """Position 0 is the start position; the rest are random playouts that stop at
    the first position showing the cyclically requested feature (so en passant,
    castling, check and promotion are all covered, not left to chance)."""
    out = [chess.Board()]
    while len(out) < COUNT:
        feature = FEATURES[len(out) % len(FEATURES)]
        b = chess.Board()
        for ply in range(220):
            if b.is_game_over(claim_draw=False):
                break
            b.push(pick(b, rng))
            if ply >= 4 and wanted(b, feature) and (feature != 'any' or rng.random() < 0.02):
                out.append(b)
                break
    return out


def legal_from(board, frm, to, color):
    piece = board.piece_at(frm)
    tgt = board.piece_at(to)
    if tgt is not None and tgt.piece_type == chess.KING and tgt.color != color:
        return None
    if tgt is not None and tgt.color == color:
        return None  # defender: no move onto an own piece exists to ask about
    if (piece.piece_type == chess.PAWN and tgt is None and chess.square_file(frm) != chess.square_file(to)
            and not (color == board.turn and board.ep_square == to and board.has_legal_en_passant())):
        return None  # diagonal control of an empty square is not a move
    b2 = board
    if color != board.turn:
        b2 = board.copy(stack=False)
        b2.turn = color
        b2.ep_square = None
    cands = [chess.Move(frm, to)]
    if piece.piece_type == chess.PAWN and chess.square_rank(to) in (0, 7):
        cands = [chess.Move(frm, to, promotion=p) for p in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT)]
    return any(b2.is_legal(m) for m in cands)


def describe(board):
    rec = {'fen': board.fen(), 'turn': 'w' if board.turn else 'b', 'check': board.is_check(),
           'checkers': sorted(sqn(s) for s in board.checkers()), 'sq': {}}
    by_from = {}
    for m in board.legal_moves:
        by_from.setdefault(m.from_square, []).append(m)
    for s in chess.SQUARES:
        piece = board.piece_at(s)
        e = {}
        e['moves'] = {m.uci(): sorted(flags(board, m)) for m in by_from.get(s, [])}
        att = {}
        legal = {}
        for color, key in ((chess.WHITE, 'w'), (chess.BLACK, 'b')):
            froms = sorted(board.attackers(color, s))
            att[key] = [sqn(f) for f in froms]
            for f in froms:
                legal[sqn(f)] = legal_from(board, f, s, color)
        e['att'] = att
        e['legal'] = legal
        if piece:
            e['pinned'] = board.is_pinned(piece.color, s)
            enemy = not piece.color
        else:
            enemy = not board.turn
        e['enemy'] = board.is_attacked_by(enemy, s)
        rec['sq'][sqn(s)] = e
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out')
    a = ap.parse_args()
    rng = random.Random(SEED)
    recs = [describe(b) for b in positions(rng)]
    doc = {'schema': 'x3dchess.inspector-expect/1', 'seed': SEED, 'oracle': 'python-chess',
           'positions': recs}
    text = json.dumps(doc, sort_keys=True, separators=(',', ':')) + '\n'
    if a.out:
        open(a.out, 'w').write(text)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
