import assert from 'node:assert/strict';
import { Chess } from '../viewer/vendor/chess.js';
import { positionReport, evaluationBinding } from '../viewer/js/position-report.js';

const initial=new Chess().fen(),r=positionReport(initial);
assert.equal(r.schema,'x3dchess.position-report/1');
assert.equal(r.fen,initial);
assert.equal(r.material.w.units,39);
assert.equal(r.material.b.units,39);
assert.equal(r.material.balance,0);
assert.deepEqual(r.material.w.counts,{p:8,n:2,b:2,r:2,q:1,k:1});
assert.equal(r.mobility.w.count,20);
assert.equal(r.mobility.b.count,20);
assert.equal(r.mobility.w.basis,'side_to_move');
assert.equal(r.mobility.b.basis,'turn_projection');
assert.deepEqual(r.pawns.w.isolated,[]);
assert.deepEqual(r.pawns.w.passed,[]);
assert.deepEqual(r.pawns.w.doubledFiles,[]);
assert.equal(r.control.length,64);
assert.equal(r.control[0].square,'a1');
assert.equal(r.control[63].square,'h8');
assert.equal(r.files.every(f => f.kind==='closed'),true);
assert.equal(r.controlSummary.w.attackRelations,r.controlSummary.b.attackRelations);

// Independent pawn answers, including an edge-file pawn and an enemy BEHIND
// the passer: only opposing pawns strictly ahead block passed-pawn status.
const pawn=positionReport('4k3/8/1p6/P7/2Pp4/2P5/7P/4K3 w - - 0 1');
assert.deepEqual(pawn.pawns.w.doubledFiles,['c']);
assert.deepEqual(pawn.pawns.w.doubledSquares,['c3','c4']);
assert.equal(pawn.pawns.w.excessPawns,1);
assert.deepEqual(pawn.pawns.w.isolated,['h2','c3','c4','a5']);
assert.deepEqual(pawn.pawns.w.passed,['h2']);
assert.deepEqual(pawn.pawns.b.passed,[]); // c3 lies ahead of black's d4 pawn.
const edge=positionReport('4k3/8/P7/1p6/8/8/8/4K3 w - - 0 1');
assert.deepEqual(edge.pawns.w.passed,['a6']);
assert.equal(pawn.material.balance,2);
assert.equal(pawn.material.imbalance.find(p => p.piece==='p').balance,2);
assert.equal(pawn.files.find(f => f.file==='f').kind,'open');
assert.equal(pawn.files.find(f => f.file==='a').kind,'semi_open_black');
assert.equal(pawn.files.find(f => f.file==='b').kind,'semi_open_white');

// Side projection never retains the real side's EP right or arbitrary castling
// claims. The real side preserves both rights, and ordinary counts remove them.
const castle=positionReport('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert.equal(castle.mobility.w.castles,2);
assert.equal(castle.mobility.w.count-castle.mobility.w.ordinaryCount,2);
assert.equal(castle.mobility.b.castles,0);
assert.equal(castle.mobility.b.enPassant,0);
const epFen='4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
const ep=positionReport(epFen);
assert.equal(ep.mobility.w.enPassant,1);
assert.equal(ep.mobility.w.count-ep.mobility.w.ordinaryCount,1);
assert.equal(ep.mobility.b.enPassant,0);
const epIllegal=positionReport('8/8/8/r4pPK/8/8/8/4k3 w - f6 0 1');
assert.equal(epIllegal.mobility.w.enPassant,0); // removing both pawns exposes rook.
const promo=positionReport('7k/P7/8/8/8/8/8/4K3 w - - 0 1');
assert.equal(promo.mobility.w.promotions,4);

// A turn flip during check can synthesize captures of the checked king. Report
// projection unavailable instead; the actual side retains its legal evasions.
const checked=positionReport('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
assert.equal(checked.position.inCheck,true);
assert.equal(checked.mobility.w.available,true);
assert.equal(checked.mobility.b.available,false);
assert.equal(checked.mobility.b.count,null);
assert.deepEqual(checked.mobility.b.moves,[]);
assert.deepEqual(checked.kingRings.w.checkers,['e2']);
const mate=positionReport('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1');
assert.equal(mate.position.checkmate,true);
assert.equal(mate.mobility.b.count,0);
assert.equal(mate.mobility.w.available,false);
const stale=positionReport('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
assert.equal(stale.position.stalemate,true);
assert.equal(stale.mobility.b.count,0);
const draw=positionReport('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
assert.equal(draw.position.insufficientMaterial,true);
assert.equal(draw.mobility.w.count,5); // generator count != game actions.

// Pinned knight still attacks f5 and the white king's ring. It has no legal
// projected moves; an attack count is not interchangeable with legal mobility.
const pinned=positionReport('4k3/4n3/8/6K1/8/8/8/4R3 w - - 0 1');
const f5=pinned.control.find(c => c.square==='f5');
assert.deepEqual(f5.blackAttackers,['e7']);
assert.equal(f5.black,1);
assert.equal(pinned.mobility.b.moves.some(m => m.from==='e7'),false);
assert.equal(pinned.kingRings.w.squares.find(s => s.square==='f5').enemyAttackers.includes('e7'),true);
assert.equal(draw.kingRings.w.squares.length,5);
assert.equal(positionReport('7k/8/8/8/8/8/8/K7 w - - 0 1').kingRings.w.squares.length,3);

// Prior-position scores must remain prior-position scores, including zero and
// mate zero. No normalization silently rebinds a raw EP identity to another FEN.
assert.equal(r.evaluation.available,false);
assert.equal(r.evaluation.binding,'unbound');
assert.equal(evaluationBinding(initial,{kind:'engine_cp',eval:0,evalFen:initial}).subjectMatches,true);
assert.equal(evaluationBinding(initial,{kind:'engine_cp',eval:0,evalFen:epFen}).binding,'different_position');
assert.equal(evaluationBinding(initial,{kind:'engine_cp',eval:123}).binding,'unbound');
assert.equal(evaluationBinding(initial,{kind:'engine_mate',mate:0,evalFen:initial}).available,true);
assert.equal(evaluationBinding(initial,{kind:'unavailable',eval:123,evalFen:initial}).available,false);
assert.equal(evaluationBinding(initial,{kind:'engine_cp',eval:NaN,evalFen:initial}).scoreCp,null);
assert.equal(evaluationBinding(initial,{evaluation_kind:'engine_cp',eval_cp:12,eval_fen:initial,score_bound:'lower',eval_ply:0}).bound,'lower');
assert.equal(evaluationBinding(epFen,{kind:'engine_cp',eval:0,evalFen:ep.canonicalFen.replace(' d6 ',' - ')}).subjectMatches,false);
assert.equal(JSON.stringify(positionReport(initial)),JSON.stringify(r));
assert.throws(() => positionReport('invalid fen'));
console.log('position-report: passed material, pawn structure, projection safeguards, special moves, check/terminal states, pinned attacks, king rings, and score subjects');
