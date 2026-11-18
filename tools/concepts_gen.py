#!/usr/bin/env python3
"""Independent known-answer generator for viewer/js/concepts.js.

Everything here is computed with python-chess (attackers_mask / attacks_mask /
legal_moves / pawn-attack bitboards) and a recursive, board-copying SEE. None of
it shares code or an algorithm with the JavaScript module:

  JS SEE   : iterative swap-list over a private occupancy array.
  python   : recursion that physically moves the least-valuable attacker on a
             python-chess Board copy and calls attackers_mask again (x-rays appear
             because the board really changed).

Usage:  python3 tools/concepts_gen.py [--out FILE] [--stdout]

The JSON it writes is the oracle for tools/concepts-test.mjs. The definitions
below are the SAME definitions documented in concepts.js (LEGEND); they are
restated here from the written definition, not translated from the JS source.
"""
import argparse
import json
import random
import sys
from pathlib import Path

import chess

SEED_BASE = 20261117
N_RANDOM = 300

P, N, B, R, Q, K = chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING
LET = {P: 'p', N: 'n', B: 'b', R: 'r', Q: 'q', K: 'k'}
SEE_VALUE = {P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000}
TIER = {P: 1, N: 3, B: 3, R: 5, Q: 9, K: 1000}   # coarse tiers for the hanging definition
ZONE_WEIGHT = {P: 1, N: 2, B: 2, R: 3, Q: 5}
CL = {chess.WHITE: 'w', chess.BLACK: 'b'}
FILES = 'abcdefgh'


def sq(i):
    return chess.square_name(i)


def sqs(mask_or_iter):
    if isinstance(mask_or_iter, int):
        mask_or_iter = chess.scan_forward(mask_or_iter)
    return [sq(i) for i in sorted(mask_or_iter)]


def rel(color, s):
    r = chess.square_rank(s)
    return r if color == chess.WHITE else 7 - r


# ---------------------------------------------------------------- SEE
def _first_capture(b, target, side):
    """Value of capturing the piece on `target` with `side`'s least valuable
    attacker and then letting the opponent continue optimally (they may stop).
    Returns None if `side` has no attacker. Not floored: this is the forced
    first capture."""
    atk = b.attackers_mask(side, target)
    if not atk:
        return None
    best = min(chess.scan_forward(atk), key=lambda s: (SEE_VALUE[b.piece_type_at(s)], s))
    victim = SEE_VALUE[b.piece_type_at(target)]
    c = b.copy(stack=False)
    mover = c.piece_at(best)
    c.remove_piece_at(best)
    c.set_piece_at(target, mover)          # promotion deliberately ignored
    reply = _first_capture(c, target, not side)
    return victim - (max(0, reply) if reply is not None else 0)


def see_all(board):
    out = []
    for s in sorted(board.piece_map()):
        p = board.piece_at(s)
        if p.piece_type == K:
            continue
        g = _first_capture(board, s, not p.color)
        out.append({'square': sq(s), 'piece': LET[p.piece_type], 'color': CL[p.color], 'gain': g})
    return out


# ---------------------------------------------------------------- hanging
def hanging(board):
    out = []
    for s in sorted(board.piece_map()):
        p = board.piece_at(s)
        if p.piece_type == K:
            continue
        a = board.attackers_mask(not p.color, s)
        d = board.attackers_mask(p.color, s)
        if not a:
            continue
        reasons = []
        if not d:
            reasons.append('undefended')
        if min(TIER[board.piece_type_at(x)] for x in chess.scan_forward(a)) < TIER[p.piece_type]:
            reasons.append('attacked_by_lower')
        if reasons:
            out.append({'square': sq(s), 'piece': LET[p.piece_type], 'color': CL[p.color],
                        'attackers': chess.popcount(a), 'defenders': chess.popcount(d), 'reasons': reasons})
    return out


# ---------------------------------------------------------------- pawns
def pawn_structure(board, color):
    own = list(board.pieces(P, color))
    enemy = list(board.pieces(P, not color))
    own_mask = int(board.pieces(P, color))
    enemy_mask = int(board.pieces(P, not color))
    files_count = {}
    for s in own:
        files_count[chess.square_file(s)] = files_count.get(chess.square_file(s), 0) + 1
    res = {k: [] for k in ('isolated', 'doubled', 'passed', 'backward', 'phalanx', 'supported', 'connected')}
    for s in sorted(own):
        f, r, rr = chess.square_file(s), chess.square_rank(s), rel(color, s)
        adj = [x for x in (f - 1, f + 1) if 0 <= x < 8]
        own_adj = [t for t in own if chess.square_file(t) in adj]
        isolated = not own_adj
        if isolated:
            res['isolated'].append(s)
        if files_count[f] >= 2:
            res['doubled'].append(s)
        # passed: no enemy pawn on files f-1..f+1 strictly ahead (relative to this colour)
        if not any(chess.square_file(t) in adj + [f] and rel(color, t) > rr for t in enemy):
            res['passed'].append(s)
        # backward (conservative): not isolated, no own pawn on an adjacent file at same or lower
        # relative rank, and the stop square is attacked by an enemy pawn.
        if not isolated and not any(rel(color, t) <= rr for t in own_adj):
            stop = s + (8 if color == chess.WHITE else -8)
            if 0 <= stop < 64 and chess.BB_PAWN_ATTACKS[color][stop] & enemy_mask:
                res['backward'].append(s)
        if any(chess.square_rank(t) == r for t in own_adj):
            res['phalanx'].append(s)
        if chess.BB_PAWN_ATTACKS[not color][s] & own_mask:
            res['supported'].append(s)
    res['connected'] = sorted(set(res['phalanx']) | set(res['supported']))
    fs = sorted(files_count)
    islands = sum(1 for i, f in enumerate(fs) if i == 0 or f != fs[i - 1] + 1)
    out = {k: sqs(v) for k, v in res.items()}
    out['doubledFiles'] = [FILES[f] for f in fs if files_count[f] >= 2]
    out['doubledCount'] = sum(c - 1 for c in files_count.values() if c >= 2)
    out['islands'] = islands
    out['count'] = len(own)
    links = []
    for t in own:
        for u in own:
            if chess.square_file(u) == chess.square_file(t) + 1 and chess.square_rank(u) == chess.square_rank(t):
                links.append((t, u, 'phalanx'))
            if chess.BB_PAWN_ATTACKS[color][t] & chess.BB_SQUARES[u]:
                links.append((t, u, 'supports'))
    out['links'] = [{'from': sq(a), 'to': sq(b), 'type': ty} for a, b, ty in sorted(links)]
    return out


def outposts(board):
    out = []
    for color in (chess.WHITE, chess.BLACK):
        enemy = list(board.pieces(P, not color))
        own_mask = int(board.pieces(P, color))
        for t in (N, B):
            for s in board.pieces(t, color):
                rr = rel(color, s)
                if not 3 <= rr <= 5:
                    continue
                if not (chess.BB_PAWN_ATTACKS[not color][s] & own_mask):
                    continue
                f = chess.square_file(s)
                if any(abs(chess.square_file(e) - f) == 1 and rel(color, e) > rr for e in enemy):
                    continue
                out.append((s, t, color))
    return [{'square': sq(s), 'piece': LET[t], 'color': CL[c]} for s, t, c in sorted(out)]


def files_and_rooks(board):
    pf = {chess.WHITE: set(), chess.BLACK: set()}
    for c in pf:
        for s in board.pieces(P, c):
            pf[c].add(chess.square_file(s))
    allp = pf[chess.WHITE] | pf[chess.BLACK]
    openf = [f for f in range(8) if f not in allp]
    half = {c: [f for f in range(8) if f not in pf[c] and f in pf[not c]] for c in pf}
    rooks = []
    for c in (chess.WHITE, chess.BLACK):
        for s in board.pieces(R, c):
            f = chess.square_file(s)
            st = 'open' if f in openf else 'half_open' if f in half[c] else 'closed'
            rooks.append((s, c, st))
    rooks.sort()
    return ({'open': [FILES[f] for f in openf],
             'halfOpen': {'w': [FILES[f] for f in half[chess.WHITE]], 'b': [FILES[f] for f in half[chess.BLACK]]}},
            [{'square': sq(s), 'color': CL[c], 'file': FILES[chess.square_file(s)], 'status': st} for s, c, st in rooks])


def king_zone(board, color):
    ks = board.king(color)
    zone = int(chess.BB_KING_ATTACKS[ks])
    pairs = weighted = attackers = 0
    hit = 0
    for s, p in board.piece_map().items():
        if p.color == color or p.piece_type == K:
            continue
        m = int(board.attacks_mask(s)) & zone
        n = chess.popcount(m)
        if n:
            pairs += n
            weighted += ZONE_WEIGHT[p.piece_type] * n
            attackers += 1
            hit |= m
    return {'king': sq(ks), 'zone': sqs(zone), 'pairs': pairs, 'weighted': weighted,
            'attackers': attackers, 'attackedSquares': sqs(hit)}


def mobility(board):
    pseudo = {}
    for color in (chess.WHITE, chess.BLACK):
        b = board.copy(stack=False)
        b.turn = color
        b.ep_square = None
        b.castling_rights = 0
        pairs = {(m.from_square, m.to_square) for m in b.generate_pseudo_legal_moves()}
        c = {k: 0 for k in 'pnbrqk'}
        for f, _t in pairs:
            c[LET[board.piece_type_at(f)]] += 1
        pseudo[CL[color]] = c
    lp = {(m.from_square, m.to_square) for m in board.legal_moves}
    lc = {k: 0 for k in 'pnbrqk'}
    for f, _t in lp:
        lc[LET[board.piece_type_at(f)]] += 1
    return {'pseudo': pseudo, 'legal': {'side': CL[board.turn], 'counts': lc}}


def bishop_pair(board):
    r = {}
    for c in (chess.WHITE, chess.BLACK):
        bs = int(board.pieces(B, c))
        r[CL[c]] = bool(bs & chess.BB_LIGHT_SQUARES) and bool(bs & chess.BB_DARK_SQUARES)
    return r


def report(fen):
    board = chess.Board(fen)
    assert board.is_valid(), fen
    see = see_all(board)
    hang = hanging(board)
    pw, pb = pawn_structure(board, chess.WHITE), pawn_structure(board, chess.BLACK)
    outp = outposts(board)
    files, rooks = files_and_rooks(board)
    kz = {'w': king_zone(board, chess.WHITE), 'b': king_zone(board, chess.BLACK)}
    bp = bishop_pair(board)
    concepts = {'hanging': hang, 'see': see, 'pawns': {'w': pw, 'b': pb}, 'outposts': outp,
                'files': files, 'rooks': rooks, 'kingZone': kz, 'mobility': mobility(board), 'bishopPair': bp}

    def order(names):
        return sorted(set(names), key=lambda n: chess.parse_square(n))

    def both(key):
        return order(pw[key] + pb[key])

    file_sq = lambda fl: [f'{x}{r}' for x in fl for r in range(1, 9)]
    half_any = sorted(set(files['halfOpen']['w']) | set(files['halfOpen']['b']))
    bishops = []
    for c in (chess.WHITE, chess.BLACK):
        if bp[CL[c]]:
            bishops += sqs(board.pieces(B, c))
    squares = {
        'hanging': order(h['square'] for h in hang),
        'see': order(e['square'] for e in see if e['gain'] is not None and e['gain'] > 0),
        'isolated': both('isolated'), 'doubled': both('doubled'), 'passed': both('passed'),
        'backward': both('backward'), 'connected': both('connected'),
        'outpost': order(o['square'] for o in outp),
        'openFiles': order(file_sq(files['open'])), 'halfOpenFiles': order(file_sq(half_any)),
        'rookFile': order(r['square'] for r in rooks if r['status'] != 'closed'),
        'kingZone': order(kz['w']['attackedSquares'] + kz['b']['attackedSquares']),
        'bishopPair': order(bishops),
    }
    return {'concepts': concepts, 'squares': squares}


# ---------------------------------------------------------------- positions
CLASSICS = [
    ('outpost_pawn_protected_knight', 'r1bq1rk1/pp3ppp/1bn2n2/3N4/4P3/8/PPP2PPP/R1BQ1RK1 w - - 0 1',
     'Nd5 supported by e4, black has no c- or e-pawn: knight outpost for white'),
    ('outpost_blocked_by_enemy_pawn', '4k3/2p5/8/3N4/4P3/8/8/4K3 w - - 0 1',
     'black c7 pawn can still advance to c6 and hit d5: NOT an outpost'),
    ('outpost_enemy_pawn_already_past', '4k3/8/8/2pN4/4P3/8/8/4K3 w - - 0 1',
     'black c5 pawn can never attack d5 (it attacks b4/d4): outpost stands'),
    ('isolated_queen_pawn', 'r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1',
     'white d4 isolated (no c/e pawns): classic IQP'),
    ('lucena_like_passed_pawn', '1K1k4/1P6/8/8/8/8/r7/5R2 w - - 0 1',
     'Lucena setup: b7 passed and isolated; rooks on open f/a files'),
    ('xray_battery_wins_pawn', '3r2k1/8/8/3p4/8/8/3R2PP/3R2K1 w - - 0 1',
     'Rd2+Rd1 battery vs Rd8 on d5 pawn: x-ray makes the capture net +100'),
    ('xray_missing_loses_exchange', '3r2k1/8/8/3p4/8/8/3R2PP/5RK1 w - - 0 1',
     'same without battery: RxP RxR loses -400 (static)'),
    ('rook_on_open_file', 'r4rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2R2K1 w - - 0 1',
     'd and e files open, Rd1 on an open file'),
    ('hanging_by_pawn_undefended_knight', 'r1bqkb1r/pppp1ppp/8/4n3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1',
     'Ne5 attacked by d4 pawn and undefended'),
    ('hanging_defended_but_lower_attacker', '4k3/8/2p5/3r4/4P3/8/8/4K3 w - - 0 1',
     'Rd5 defended by c6 but attacked by a pawn: hanging by definition, SEE +400'),
    ('doubled_isolated_c_pawns', '4k3/8/8/8/8/2P5/2P1PPPP/4K3 w - - 0 1',
     'c2/c3 doubled and isolated'),
    ('backward_d6', '6k1/pp3ppp/3p4/4p3/2P5/8/PP3PPP/6K1 w - - 0 1',
     'black d6: only neighbour e5 is more advanced, stop d5 hit by c4: backward'),
    ('king_zone_queen_rook', '6k1/5ppp/8/8/6Q1/8/6PP/5RK1 w - - 0 1',
     'Qg4 hits g7, Rf1 hits f7: 2 pairs, weighted 5+3'),
    ('bishop_pair', '4k3/8/8/8/8/8/8/2BBK3 w - - 0 1', 'white has c1 (dark) and d1 (light) bishops'),
    ('four_pawn_islands', '4k3/8/8/8/8/8/P1P1P1P1/4K3 w - - 0 1', 'a,c,e,g pawns: four islands, all isolated'),
    ('connected_chain', '4k3/8/8/8/3PP3/2P5/1P6/4K3 w - - 0 1', 'd4-e4 phalanx; b2 supports c3 supports d4'),
    ('see_pawn_guards_knight', '4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', 'RxN, pawn retakes rook: -180'),
    ('see_cpw_multi_attacker', '1k1r3q/1ppn3p/p4b2/4p3/8/P2N2P1/1PP1R1BP/2K1Q3 w - - 0 1',
     'multi-piece exchange on e5 with x-rays on both sides: -220'),
    ('see_undefended_pawn', '1k1r4/1pp4p/p7/4p3/8/P5P1/1PP4P/2K1R3 w - - 0 1', 'Rxe5 wins a clean pawn: +100'),
    ('passed_vs_blocked', '4k3/p7/8/3P4/8/8/P7/4K3 w - - 0 1', 'd5 passed; a2/a7 block each other'),
    ('half_open_file_rook', '4rrk1/pp3ppp/8/8/4P3/8/PPP2PPP/2R3K1 w - - 0 1',
     'e-file half-open for black (Re8), d open, c half-open for black'),
    ('greek_gift_shape', 'r1bq1rk1/pppn1ppp/4p3/3pP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 1',
     'Bd3/Nf3 aim at the castled king'),
    ('start_position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'nothing hanging, 20 legal moves'),
    ('stalemate_zero_legal', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'black stalemated: legal mobility 0 yet pseudo > 0'),
    ('same_colour_bishops', '4k3/8/8/8/8/4B3/8/2B1K3 w - - 0 1', 'two dark-square bishops: no pair'),
    ('en_passant_legal_vs_pseudo', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'legal pawn count includes ep, pseudo does not'),
    ('two_queens', '4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1', 'x-ray along rank 1: Qa1 behind Qb1'),
]


def random_positions():
    out = []
    for i in range(N_RANDOM):
        rng = random.Random(SEED_BASE + i)
        board = chess.Board()
        target = rng.randint(6, 110)
        for _ in range(target):
            moves = list(board.legal_moves)
            if not moves:
                break
            board.push(rng.choice(moves))
        while board.is_game_over() and board.move_stack:
            board.pop()
        out.append((f'random_{i:03d}', board.fen(), f'seed {SEED_BASE + i}, {len(board.move_stack)} random plies'))
    return out


def build():
    entries = []
    for kind, rows in (('classic', CLASSICS), ('random', random_positions())):
        for id_, fen, note in rows:
            entries.append({'id': id_, 'kind': kind, 'fen': fen, 'note': note, 'expected': report(fen)})
    return {'schema': 'x3dchess.concepts-fixtures/1', 'generator': 'tools/concepts_gen.py',
            'oracle': 'python-chess ' + chess.__version__ + ' (attackers_mask, attacks_mask, legal_moves, pawn attack bitboards)',
            'seed_base': SEED_BASE, 'random_count': N_RANDOM, 'classic_count': len(CLASSICS),
            'see_values': {LET[k]: v for k, v in SEE_VALUE.items()}, 'positions': entries}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(Path(__file__).with_name('concepts_fixtures.json')))
    ap.add_argument('--stdout', action='store_true')
    a = ap.parse_args(argv)
    data = build()
    text = '{\n"schema":' + json.dumps(data['schema']) + ',\n' + ',\n'.join(
        f'"{k}":' + json.dumps(v, separators=(',', ':')) for k, v in data.items() if k not in ('schema', 'positions')) + \
        ',\n"positions":[\n' + ',\n'.join(json.dumps(e, separators=(',', ':')) for e in data['positions']) + '\n]\n}\n'
    json.loads(text)
    if a.stdout:
        sys.stdout.write(text)
    else:
        Path(a.out).write_text(text, encoding='utf-8')
        print(json.dumps({'written': a.out, 'positions': len(data['positions']), 'bytes': len(text)}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
