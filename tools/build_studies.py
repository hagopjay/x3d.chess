#!/usr/bin/env python3
"""Build seven synthetic chess-rule fixtures with independent saved witnesses.

Requires python-chess from server/requirements.txt. Browser verification uses
the separately implemented vendored chess.js, not a translation of this code.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import chess

ROOT=Path(__file__).resolve().parents[1]
GOLD='0.95 0.68 0.26'; CORAL='1 0.32 0.28'; MINT='0.32 0.91 0.72'
FIDE='https://handbook.fide.com/chapter/e012023'


def mark(squares=(),lines=()):
    return {'squares':[{'square':s,'color':c} for s,c in squares],
            'lines':[{'from':a,'to':b,'color':c} for a,b,c in lines]}


CASES=[
{'id':'pin-paradox','title':'Pinned is not powerless','tag':'ATTACKS / LEGALITY',
 'question':'May the white king step onto f5 when the attacking knight is pinned?',
 'insight':'An attacked square and a legal destination answer different questions.',
 'explanation':'The e-file rook pins the black knight to its king. That limits the knight’s legal movement, but the knight still attacks f5. The white king cannot step there. Moving the rook away removes the pin, while the attack on f5 remains.',
 'articles':['3.1.3','3.9.1','3.9.2'],
 'variants':[
  {'id':'pinned','label':'Knight pinned', 'fen':'4k3/4n3/8/8/5K2/8/8/4R3 w - - 0 1',
   'highlights':mark([('e7',GOLD),('f5',CORAL)],[('e1','e8',GOLD),('e7','f5',CORAL)]),
   'attack_queries':[{'square':'f5','color':'b'}], 'pin_queries':[{'square':'e7','color':'b'}]},
  {'id':'unpinned','label':'Rook moved aside','fen':'4k3/4n3/8/8/5K2/8/8/R7 w - - 0 1',
   'highlights':mark([('e7',MINT),('f5',CORAL)],[('e7','f5',CORAL)]),
   'attack_queries':[{'square':'f5','color':'b'}], 'pin_queries':[{'square':'e7','color':'b'}]}],
 'probes':[{'uci':'f4f5','label':'Try Kf5','expected_legal':[False,False],
            'illegal':'Kf5 is illegal: the knight on e7 attacks f5, even while pinned.'},
           {'uci':'f4g4','label':'Compare Kg4','expected_legal':[True,True]}]},
{'id':'en-passant-ray','title':'The capture that opens a rank','tag':'EN PASSANT / OCCUPANCY',
 'question':'Why is gxf6 en passant illegal when f6 looks harmless?',
 'insight':'An en passant capture changes three squares, not two.',
 'explanation':'Both the pawn leaving g5 and the pawn removed from f5 currently block the rook’s fifth-rank line. En passant would remove both blockers and expose the white king on h5. Move the rook to the fourth rank and the same pawn capture becomes legal.',
 'articles':['3.7.3.1','3.7.3.2','3.9.2'],
 'variants':[
  {'id':'rank-exposure','label':'Rook on fifth rank','fen':'k7/8/8/r4pPK/8/8/8/8 w - f6 0 1',
   'highlights':mark([('f5',GOLD),('g5',GOLD),('f6',MINT),('h5',CORAL)],[('a5','h5',CORAL)])},
  {'id':'rank-clear','label':'Rook moved off rank','fen':'k7/8/8/5pPK/r7/8/8/8 w - f6 0 1',
   'highlights':mark([('f5',GOLD),('g5',GOLD),('f6',MINT)],[('a4','h4',GOLD)])}],
 'probes':[{'uci':'g5f6','label':'Try gxf6 e.p.','expected_legal':[False,True],
            'illegal':'The capture would remove both fifth-rank pawns and leave the king exposed to the rook.'},
           {'uci':'g5g6','label':'Compare g6','expected_legal':[True,True]}]},
{'id':'underpromotion','title':'When a queen brings a draw','tag':'PROMOTION / TERMINAL STATES',
 'question':'Does promoting to the most valuable piece always help?',
 'insight':'A material advantage cannot override a terminal draw.',
 'explanation':'Promote on c8 and inspect the black king’s replies. A queen leaves no legal move without giving check: stalemate. A rook leaves Ka6 available. Bishop and knight promotions produce insufficient-material draws in this fixture. No engine win claim is needed to establish those differences.',
 'articles':['3.7.3.3','3.7.3.5','5.2.1','5.2.2'],
 'variants':[{'id':'promotion-choice','label':'Choose a promotion','fen':'8/k1P5/2K5/8/8/8/8/8 w - - 0 1',
              'highlights':mark([('c7',GOLD),('c8',MINT),('a7',CORAL)],[('c7','c8',MINT)])}],
 'probes':[{'uci':'c7c8q','label':'Promote to queen','expected_legal':[True],'expected_stalemate':True},
           {'uci':'c7c8r','label':'Promote to rook','expected_legal':[True],'expected_stalemate':False,'expected_replies':['a7a6']},
           {'uci':'c7c8b','label':'Promote to bishop','expected_legal':[True],'expected_insufficient':True},
           {'uci':'c7c8n','label':'Promote to knight','expected_legal':[True],'expected_insufficient':True}]},
{'id':'castling-transit','title':'The square the king must cross','tag':'CASTLING / PATH CONSTRAINTS',
 'question':'Can White castle when e1 and g1 are safe, but f1 is attacked?',
 'insight':'A legal destination does not make every route legal.',
 'explanation':'The black rook attacks f1, the square crossed by the white king. That prevents castling even though the king’s starting and landing squares are safe. Move the black rook to the a-file and compare the same castling move.',
 'articles':['3.8.2','3.8.2.2'],
 'variants':[
  {'id':'transit-attacked','label':'Transit square attacked','fen':'k4r2/8/8/8/8/8/8/4K2R w K - 0 1',
   'highlights':mark([('e1',MINT),('f1',CORAL),('g1',MINT)],[('f8','f1',CORAL),('e1','g1',GOLD)]),
   'attack_queries':[{'square':s,'color':'b'} for s in ('e1','f1','g1')]},
  {'id':'transit-safe','label':'Rook moved aside','fen':'rk6/8/8/8/8/8/8/4K2R w K - 0 1',
   'highlights':mark([('e1',MINT),('f1',MINT),('g1',MINT)],[('e1','g1',MINT)]),
   'attack_queries':[{'square':s,'color':'b'} for s in ('e1','f1','g1')]}],
 'probes':[{'uci':'e1g1','label':'Try O-O','expected_legal':[False,True],
            'illegal':'Castling is illegal while f1, the king’s transit square, is attacked.'},
           {'uci':'e1e2','label':'Compare Ke2','expected_legal':[True,True]}]}
]


def need(ok,message):
    if not ok:raise ValueError(message)


def witness(board):
    return {'fen':board.fen(en_passant='legal'),
            'legal_moves':sorted(m.uci() for m in board.legal_moves),
            'check':board.is_check(),'stalemate':board.is_stalemate(),
            'insufficient':board.is_insufficient_material(),'checkmate':board.is_checkmate()}


def main():
    for case in CASES:
        for i,variant in enumerate(case['variants']):
            board=chess.Board(variant['fen'])
            need(board.is_valid(),case['id']+' invalid synthetic position')
            variant['witness']=witness(board)
            for query in variant.get('attack_queries',[]):
                color=query['color']=='w';square=chess.parse_square(query['square'])
                query['expected_attackers']=sorted(chess.square_name(s) for s in board.attackers(color,square))
            for query in variant.get('pin_queries',[]):
                query['expected_pinned']=board.is_pinned(query['color']=='w',chess.parse_square(query['square']))
            variant['probes']=[]
            for probe in case['probes']:
                move=chess.Move.from_uci(probe['uci']);legal=board.is_legal(move)
                need(legal==probe['expected_legal'][i],case['id']+' manual legality control disagrees')
                row={'uci':probe['uci'],'legal':legal}
                if legal:
                    after=board.copy();after.push(move);row['after']=witness(after)
                    for key,attr in [('expected_stalemate','stalemate'),('expected_insufficient','insufficient'),('expected_replies','legal_moves')]:
                        if key in probe:need(row['after'][attr]==probe[key],case['id']+' manual terminal control disagrees')
                variant['probes'].append(row)
    producer=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    data={'schema':'x3dchess.studies/1','scope':'Synthetic orthodox-chess rule experiments; no engine search, rating or best-move claim.',
          'producer_sha256':producer,'oracle':{'name':'python-chess','version':chess.__version__},
          'sources':[{'id':'fide','title':'FIDE Laws of Chess, articles 3 and 5','url':FIDE},
                     {'id':'python-chess','title':'python-chess core rules API','url':'https://python-chess.readthedocs.io/en/latest/core.html'},
                     {'id':'chess-js','title':'chess.js rules API','url':'https://jhlywa.github.io/chess.js/v1.4.0/'}],
          'studies':CASES}
    out=ROOT/'viewer/data';out.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(data,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
    (out/'studies.json').write_bytes(raw)
    manifest={'schema':'x3dchess.study-manifest/1','file':'studies.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
              'producer_sha256':producer,'studies':len(CASES),'positions':sum(len(c['variants']) for c in CASES)}
    (out/'studies.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    evidence=ROOT/'evidence';evidence.mkdir(exist_ok=True)
    (evidence/'study-build.json').write_text(json.dumps({**manifest,'status':'pass','created_utc':datetime.now(timezone.utc).isoformat(),
        'scope':'All source FENs valid; manual legal/illegal/terminal controls agree with python-chess. Browser chess.js checks are separate.'},indent=2)+'\n')
    print(json.dumps(manifest))


if __name__=='__main__':main()
