// Current-position facts for the optional analysis desk. Pure, bounded, and
// deliberately independent of render state and engine workers.
import { Chess } from '../vendor/chess.js';
import { pieceArray, sqName } from './analysis.js';

const FILES = 'abcdefgh';
export const MATERIAL_VALUES = Object.freeze({ p:1, n:3, b:3, r:5, q:9, k:0 });
const TYPES = Object.keys(MATERIAL_VALUES);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const other = c => c === 'w' ? 'b' : 'w';
const uci = m => m.from + m.to + (m.promotion || '');

export const REPORT_NOTES = Object.freeze({
  material: 'Authored material units: P=1, N=3, B=3, R=5, Q=9; kings have no material value. This is not an engine evaluation.',
  mobility: 'The side to move has its actual legal move-generator output, including special moves. The other side is a hypothetical turn projection with castling and en passant removed; it is unavailable when the real side to move is in check. Ordinary counts exclude castling and en passant on both sides. Promotion choices count separately. These counts are not a game-action count or a position evaluation.',
  pawns: 'A passed pawn has no opposing pawn ahead on its own or an adjacent file. An isolated pawn has no friendly pawn on an adjacent file. Doubled files contain at least two friendly pawns. These are structural facts, not winning or weak-pawn verdicts.',
  kingRing: 'King ring: the on-board adjacent squares around the king. Enemy geometric attacks count even from pinned pieces and with current occupants left in place. This is not a list of legal king escapes or a king-safety score.',
  control: 'Geometric attack-count balance = white attackers minus black attackers. Pinned pieces still attack. Counts do not establish legal mobility, safe capture, exchange outcome, or win probability.',
  history: 'A FEN does not contain complete repetition history. Legal move-generator output can remain nonzero in a drawn position; no game-continuation or draw-claim recommendation is implied.',
});

function materialFor(a, color) {
  const counts = Object.fromEntries(TYPES.map(t => [t,0]));
  for (const p of a) if (p?.color === color) counts[p.type]++;
  return { counts, units:TYPES.reduce((n,t) => n + counts[t]*MATERIAL_VALUES[t],0), bishopPair:counts.b >= 2 };
}

function pawnsFor(a, color) {
  const own=[],enemy=[],files=new Array(8).fill(0);
  a.forEach((p,i) => {
    if (p?.type !== 'p') return;
    if (p.color === color) { own.push(i); files[i%8]++; } else enemy.push(i);
  });
  const dir=color==='w'?1:-1;
  const isolated=own.filter(i => !files[i%8-1] && !files[i%8+1]);
  const passed=own.filter(i => !enemy.some(e => Math.abs(e%8-i%8)<=1 && (Math.floor(e/8)-Math.floor(i/8))*dir>0));
  const doubledFiles=files.flatMap((n,i) => n>1?[FILES[i]]:[]);
  return { squares:own.map(sqName), files, doubledFiles,
    doubledSquares:own.filter(i => files[i%8]>1).map(sqName),
    excessPawns:files.reduce((n,c) => n+Math.max(0,c-1),0),
    isolated:isolated.map(sqName), passed:passed.map(sqName) };
}

function mobilityFor(chess, color) {
  const actual=color===chess.turn();
  // A null move while checked is not a legal chess position: the previous side
  // would be allowed to capture the checked king. Do not feed it to moves().
  if (!actual && chess.isCheck()) return {
    available:false, basis:'turn_projection', count:null, ordinaryCount:null,
    reason:'The real side to move is in check; turn projection is undefined.', moves:[],
  };
  let subject=chess;
  if (!actual) {
    const f=chess.fen().split(' '); f[1]=color; f[2]='-'; f[3]='-';
    subject=new Chess(f.join(' '));
  }
  const moves=subject.moves({ verbose:true }).map(m => ({
    uci:uci(m), san:m.san, from:m.from, to:m.to, promotion:m.promotion||null,
    capture:m.flags.includes('c')||m.flags.includes('e'),
    castle:m.flags.includes('k')||m.flags.includes('q'),
    enPassant:m.flags.includes('e'), check:/[+#]$/.test(m.san),
  }));
  return { available:true, basis:actual?'side_to_move':'turn_projection',
    count:moves.length, ordinaryCount:moves.filter(m => !m.castle&&!m.enPassant).length,
    captures:moves.filter(m => m.capture).length, checks:moves.filter(m => m.check).length,
    castles:moves.filter(m => m.castle).length, enPassant:moves.filter(m => m.enPassant).length,
    promotions:moves.filter(m => m.promotion).length, moves,
    reason:actual?'Actual legal move-generator output for the displayed FEN.':'Hypothetical other turn; castling rights and en passant removed.',
  };
}

function kingRing(a, control, color) {
  const i=a.findIndex(p => p?.color===color && p.type==='k');
  if (i<0) return { square:null, squares:[], attackedSquares:0, enemyAttackRelations:0, checkers:[] };
  const f=i%8,r=Math.floor(i/8),squares=[];
  for(let dr=-1;dr<=1;dr++)for(let df=-1;df<=1;df++) {
    if ((!df&&!dr)||f+df<0||f+df>7||r+dr<0||r+dr>7)continue;
    const c=control[(r+dr)*8+f+df];
    squares.push({ square:c.square, enemyAttackers:color==='w'?c.blackAttackers:c.whiteAttackers });
  }
  return { square:sqName(i), squares,
    attackedSquares:squares.filter(s => s.enemyAttackers.length>0).length,
    enemyAttackRelations:squares.reduce((n,s) => n+s.enemyAttackers.length,0),
    checkers:color==='w'?control[i].blackAttackers:control[i].whiteAttackers };
}

/** Bind a display record's score to its exact supplied FEN; never infer a missing subject. */
export function evaluationBinding(fen, evaluation=null) {
  const e=evaluation||{},sourceFen=e.evalFen??e.eval_fen??null;
  const scoreCp=e.eval??e.eval_cp??null,mate=e.mate??e.mate_in??null;
  const kind=e.kind??e.evaluation_kind??'unavailable';
  const available=kind!=='unavailable'&&(finite(scoreCp)||finite(mate));
  const binding=!sourceFen?'unbound':sourceFen===fen?'current_position':'different_position';
  return { available, kind, scoreCp:finite(scoreCp)?scoreCp:null,
    mate:finite(mate)?mate:null, bound:e.bound??e.score_bound??null,
    sourceFen, sourcePly:e.evalPly??e.eval_ply??null, perspective:'white',
    binding, subjectMatches:binding==='current_position',
    note:!available?'No numeric score is available.':binding==='current_position'?
      'Score source matches this exact FEN. A search score is not a win probability.':binding==='different_position'?
      'This score belongs to a different position, often before the displayed move; do not assign it to this board.':
      'The score has no source FEN; it cannot be assigned to this position.',
  };
}

/** Build bounded facts from one FEN. Does not mutate a game or invent search output. */
export function positionReport(fen, { evaluation=null }={}) {
  const chess=new Chess(fen),a=pieceArray(chess);
  const w=materialFor(a,'w'),b=materialFor(a,'b');
  const pawns={w:pawnsFor(a,'w'),b:pawnsFor(a,'b')};
  const control=Array.from({length:64},(_,i) => {
    const square=sqName(i),whiteAttackers=chess.attackers(square,'w'),blackAttackers=chess.attackers(square,'b');
    return { square,white:whiteAttackers.length,black:blackAttackers.length,
      balance:whiteAttackers.length-blackAttackers.length,whiteAttackers,blackAttackers };
  });
  const controlSummary=Object.fromEntries(['w','b'].map(color => {
    const k=color==='w'?'white':'black';
    return [color,{attackedSquares:control.filter(c => c[k]>0).length,
      attackRelations:control.reduce((n,c) => n+c[k],0)}];
  }));
  const files=Array.from({length:8},(_,i) => ({file:FILES[i],whitePawns:pawns.w.files[i],blackPawns:pawns.b.files[i],
    kind:!pawns.w.files[i]&&!pawns.b.files[i]?'open':!pawns.w.files[i]?'semi_open_white':!pawns.b.files[i]?'semi_open_black':'closed'}));
  return { schema:'x3dchess.position-report/1',fen,canonicalFen:chess.fen(),turn:chess.turn(),
    position:{inCheck:chess.isCheck(),checkmate:chess.isCheckmate(),stalemate:chess.isStalemate(),insufficientMaterial:chess.isInsufficientMaterial()},
    material:{w,b,balance:w.units-b.units,
      imbalance:TYPES.filter(t => t!=='k').map(piece => ({piece,white:w.counts[piece],black:b.counts[piece],balance:w.counts[piece]-b.counts[piece],units:(w.counts[piece]-b.counts[piece])*MATERIAL_VALUES[piece]}))},
    mobility:{w:mobilityFor(chess,'w'),b:mobilityFor(chess,'b')},pawns,files,control,controlSummary,
    kingRings:{w:kingRing(a,control,'w'),b:kingRing(a,control,'b')},
    evaluation:evaluationBinding(fen,evaluation),notes:REPORT_NOTES };
}
