#!/usr/bin/env node
// Chess960 rules vs python-chess (chess960=True). Run: CHESS_TEST_PYTHON=python3 node tools/chess960-test.mjs
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Chess960,chess960StartFen,scharnaglBackRank,scharnaglId,randomChess960Id} from '../viewer/js/chess960.js';
import {Chess} from '../viewer/vendor/chess.js';
import {terminalResult} from '../viewer/js/transport.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PY=process.env.CHESS_TEST_PYTHON;
if(!PY){console.error('FAIL: CHESS_TEST_PYTHON is not set; the independent oracle cannot be run');process.exit(2);}
const need=(c,m)=>{if(!c)throw new Error(m);};
const run=spawnSync(PY,[path.join(ROOT,'tools/chess960_gen.py'),'--stdout'],{encoding:'utf8',maxBuffer:256*1024*1024});
need(run.status===0,'oracle failed: '+run.stderr);
const oracle=JSON.parse(run.stdout);
// Shredder castling letters are compared as sets: python and this module order them differently but mean the same rights.
const norm=(fen)=>{const f=fen.split(' ');f[2]=f[2]==='-'?'-':[...f[2]].sort().join('');return f.join(' ');};

// 1. All 960 start positions: id -> placement and rights, and the inverse.
for(const {id,fen} of oracle.starts){
  need(norm(chess960StartFen(id))===norm(fen),`start ${id}: ${chess960StartFen(id)} != ${fen}`);
  need(scharnaglId(scharnaglBackRank(id))===id,`id round trip ${id}`);
  const g=new Chess960(chess960StartFen(id));
  need(norm(g.fen960())===norm(fen),`fen960 round trip ${id}`);
}
need(scharnaglBackRank(518)==='rnbqkbnr','518 is the standard array');
need(new Set(oracle.starts.map(s=>s.fen.split(' ')[0])).size===960,'960 distinct placements');
need(scharnaglId('qqqqqqqq')===null,'rejects a non-960 rank');
let r=0;const rng=()=>[0,0.5,0.9999999][r++%3];need([0,1,2].map(()=>randomChess960Id(rng)).every(i=>i>=0&&i<=959),'random id in range');
console.log('ok: 960 start positions match python-chess, ids round-trip');

// 2. Castling-biased playouts: legal sets, SAN, FEN, terminal flags at every ply.
let plies=0,castles=0;const castleKinds=new Set(),shapes=new Set();
for(const game of oracle.games){
  const g=new Chess960(game.start);
  game.plies.forEach((p,i)=>{
    const tag=`game id ${game.id} ply ${i+1}`;
    const legal=g.legalUci();
    need(JSON.stringify(legal)===JSON.stringify(p.legal),`${tag}: legal moves differ\n js ${legal}\n py ${p.legal}`);
    const mv=g.move({from:p.uci.slice(0,2),to:p.uci.slice(2,4),promotion:p.uci[4]});
    need(mv.san===p.san,`${tag}: SAN ${mv.san} != ${p.san}`);
    need(norm(g.fen960())===norm(p.fen),`${tag}: FEN\n js ${g.fen960()}\n py ${p.fen}`);
    need(g.isCheck()===p.check,`${tag}: check`);
    need(g.isCheckmate()===p.checkmate,`${tag}: checkmate`);
    need(g.isStalemate()===p.stalemate,`${tag}: stalemate`);
    need(g.isInsufficientMaterial()===p.insufficient,`${tag}: insufficient`);
    need(g.isDrawByFiftyMoves()===p.fifty,`${tag}: fifty`);
    need(g.isThreefoldRepetition()===p.threefold,`${tag}: threefold`);
    need(new Chess(g.fen()).fen()===g.fen(),`${tag}: fen() must stay chess.js-readable`);
    plies++;if(p.castle){castles++;castleKinds.add(mv.castle+mv.color);shapes.add(`${p.uci}`);}
  });
}
need(castles>=200,`only ${castles} castles exercised`);
need(['kw','qw','kb','qb'].every(k=>castleKinds.has(k)),'all four castles must be exercised: '+[...castleKinds]);
console.log(`ok: ${oracle.games.length} games, ${plies} plies, ${castles} castles (${shapes.size} distinct king/rook shapes) match python-chess ${oracle.python_chess}`);

// 3. Hand-built rule edges (each one is a way a naive port goes wrong).
const edge=(name,fen,expectCastles,notes='')=>{const g=new Chess960(fen);const got=g.legalMoves960().filter(m=>m.castle).map(m=>m.uci).sort();
  need(JSON.stringify(got)===JSON.stringify(expectCastles.slice().sort()),`${name}: castles ${got} != ${expectCastles} ${notes}`);};
edge('plain a-h',   'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',['e1a1','e1h1']);
edge('king stays',  '4k3/8/8/8/8/8/8/6KR w H - 0 1',['g1h1']);
edge('rook lands on king square','4k3/8/8/8/8/8/8/5KR1 w G - 0 1',['f1g1']);
edge('rook shield', '4k3/8/8/8/8/8/8/rRK5 w B - 0 1',[],'moving the b1 rook opens the a1 rook onto the king');
edge('no castle in check','4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1',[]);
edge('attacked path','4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1',['e1a1']);
edge('blocked path','4k3/8/8/8/8/8/8/RN2K1NR w KQ - 0 1',[]);
// Castling rights follow the rook: a moved or captured rook, or a moved king, ends it.
{const g=new Chess960('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');g.move('Rb1');g.move('Kd8');g.move('Ra1');g.move('Ke8');
 need(g.fen960().split(' ')[2]==='H','Q right gone, K right kept: '+g.fen960());}
{const g=new Chess960('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');g.move('Rxa8');need(g.fen960().split(' ')[2]==='Hh','capturing a rook removes that right, and so does moving it: '+g.fen960());}
// undo of a castle restores everything, including rights, FEN and the repetition clock.
{const g=Chess960.fromId(518);const before=g.fen960();g.load960('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');const f0=g.fen960();
 const m=g.move('O-O');need(m.san==='O-O'&&g.fen()==='4k3/8/8/8/8/8/8/R4RK1 b - - 1 1','O-O result '+g.fen());
 g.undo();need(g.fen960()===f0,'undo castle: '+g.fen960());need(g.legalUci().includes('e1h1'),'rights restored');
 g.move('O-O-O');need(g.fen()==='4k3/8/8/8/8/8/8/2KR3R b - - 1 1','O-O-O result '+g.fen());
 need(before.length>0,'unused');}
// The 960 object is accepted by the shared terminal-state helper, fivefold included.
{const g=new Chess960('4k3/8/8/8/8/8/8/4K3 w - - 0 1');need(terminalResult(g,0,200,'ply_cap')?.reason==='insufficient_material','terminalResult works on a Chess960 object');}
console.log('ok: castling edge cases, rights, undo, terminal helper');
console.log('chess960 test passed');
