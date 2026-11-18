#!/usr/bin/env node
// Tests for viewer/js/concepts.js.
// Run: cd /home/user/x3d.chess && CHESS_TEST_PYTHON=python3 node tools/concepts-test.mjs
//
// Layers:
//  1. Known-answer fixtures (tools/concepts_fixtures.json) produced by tools/concepts_gen.py with python-chess
//     (attackers_mask / attacks_mask / legal_moves, board-copying recursive SEE). Every fixture must match exactly.
//  2. Regeneration: the generator is re-run and must reproduce the committed fixture bytes (so the file was not hand-edited).
//  3. HAND table: literal expectations reasoned by hand (not copied from any program output); reasoning is in the comments.
//  4. Negative controls: mutated fixtures must be reported as disagreements; bad FEN / squares are rejected.
//  5. Geometry: coordinates checked against hand arithmetic; XML validated with the pinned X3D 4.0 validator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {conceptsReport,staticExchange,hangingPieces,conceptGeometry,conceptsXml,conceptUpdates,
  CONCEPT_IDS,LEGEND,LABELS,SEE_VALUES,conceptDef} from '../viewer/js/concepts.js';
import {projectPortableX3D} from '../viewer/js/export.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PY=process.env.CHESS_TEST_PYTHON;
let checks=0;const ok=(cond,msg)=>{checks++;assert.ok(cond,msg);};
const eq=(a,b,msg)=>{checks++;assert.deepEqual(a,b,msg);};
if(!PY){console.error('FAIL: CHESS_TEST_PYTHON is not set; the independent oracle cannot be run');process.exit(2);}

// ---------------------------------------------------------------- 1. fixtures
const fixtureText=fs.readFileSync(path.join(ROOT,'tools/concepts_fixtures.json'),'utf8');
const fixtures=JSON.parse(fixtureText);
ok(fixtures.schema==='x3dchess.concepts-fixtures/1','fixture schema');
const classics=fixtures.positions.filter(p=>p.kind==='classic'),randoms=fixtures.positions.filter(p=>p.kind==='random');
ok(randoms.length>=300,'at least 300 random positions, have '+randoms.length);
ok(classics.length>=25,'at least 25 classic positions, have '+classics.length);
ok(new Set(fixtures.positions.map(p=>p.fen)).size>=fixtures.positions.length-3,'fixture FENs are (nearly) all distinct');
eq(fixtures.see_values,SEE_VALUES,'generator and module use the same SEE value table');

/** returns a list of path strings where expected and actual differ */
function diff(exp,act,p='',out=[]){
  if(exp&&typeof exp==='object'&&act&&typeof act==='object'&&Array.isArray(exp)===Array.isArray(act)){
    for(const k of new Set([...Object.keys(exp),...Object.keys(act)]))diff(exp[k],act[k],p+'/'+k,out);
  }else if(exp!==act)out.push(p+' expected '+JSON.stringify(exp)+' got '+JSON.stringify(act));
  return out;
}
function compareFixture(f){
  const r=conceptsReport(f.fen);
  return [...diff(f.expected.concepts,r.concepts,f.id+':concepts'),...diff(f.expected.squares,r.squares,f.id+':squares')];
}
const disagreements=fixtures.positions.flatMap(compareFixture);
if(disagreements.length)console.error(disagreements.slice(0,20).join('\n'));
eq(disagreements.length,0,'JS module disagrees with python-chess oracle in '+disagreements.length+' places');

// coverage: the fixtures must actually exercise each concept (otherwise "all match" could be vacuous)
const cov={hangingPos:0,seePos:0,seeNeg:0,seeNull:0,isolated:0,doubled:0,passed:0,backward:0,phalanx:0,supported:0,outposts:0,
  open:0,halfOpen:0,rookOpen:0,rookHalf:0,zone:0,pair:0,legalLtPseudo:0};
for(const f of fixtures.positions){
  const c=f.expected.concepts;
  if(c.hanging.length)cov.hangingPos++;
  if(c.see.some(e=>e.gain>0))cov.seePos++;if(c.see.some(e=>e.gain<0))cov.seeNeg++;if(c.see.some(e=>e.gain===null))cov.seeNull++;
  for(const col of['w','b']){const p=c.pawns[col];
    if(p.isolated.length)cov.isolated++;if(p.doubled.length)cov.doubled++;if(p.passed.length)cov.passed++;if(p.backward.length)cov.backward++;
    if(p.phalanx.length)cov.phalanx++;if(p.supported.length)cov.supported++;
    if(c.kingZone[col].pairs>0)cov.zone++;}
  if(c.outposts.length)cov.outposts++;
  if(c.files.open.length)cov.open++;if(c.files.halfOpen.w.length||c.files.halfOpen.b.length)cov.halfOpen++;
  if(c.rooks.some(r=>r.status==='open'))cov.rookOpen++;if(c.rooks.some(r=>r.status==='half_open'))cov.rookHalf++;
  if(c.bishopPair.w||c.bishopPair.b)cov.pair++;
  const lg=c.mobility.legal.counts,ps=c.mobility.pseudo[c.mobility.legal.side];
  if(Object.keys(lg).some(k=>lg[k]<ps[k]))cov.legalLtPseudo++;
}
for(const [k,v] of Object.entries(cov))ok(v>=3,'fixtures exercise '+k+' only '+v+' times');
// SEE x-ray depth: the three-capture fixture is covered by HAND below; here require some deep random sequences too
let deep=0;for(const f of randoms.slice(0,120))for(const e of f.expected.concepts.see)if(e.gain!=null&&staticExchange(f.fen,e.square).sequence.length>=3)deep++;
ok(deep>0,'random fixtures contain exchanges with three or more captures');
console.log(`PASS fixtures: ${fixtures.positions.length} positions (${randoms.length} random + ${classics.length} classic), 0 disagreements; coverage`,JSON.stringify(cov),'deep SEE in first 120 randoms:',deep);

// ---------------------------------------------------------------- 2. regeneration must reproduce the committed file
{
  const r=spawnSync(PY,[path.join(ROOT,'tools/concepts_gen.py'),'--stdout'],{encoding:'utf8',maxBuffer:64*1024*1024});
  ok(r.status===0,'generator runs: '+r.stderr);
  ok(r.stdout===fixtureText,'re-running the generator reproduces tools/concepts_fixtures.json byte-for-byte');
  console.log('PASS regeneration: python-chess oracle reproduces the fixture file byte-for-byte');
}

// ---------------------------------------------------------------- 3. HAND-verified positions
const F=Object.fromEntries(classics.map(p=>[p.id,p.fen]));
const R=id=>conceptsReport(F[id]),C=id=>R(id).concepts,gainOf=(id,sq)=>C(id).see.find(e=>e.square===sq).gain;
const sqs=l=>l.map(e=>e.square);
// 1. Pawn-protected knight outpost. White Nd5, pawn e4 attacks d5. Black has pawns a7 b7 f7 g7 h7 only: nothing on c/e files, so no black
//    pawn can ever attack d5. Relative rank 5 (4-6 allowed). Black N/B on b6,c6,f6 are on black-relative rank 3 -> outside 4-6, not outposts.
eq(C('outpost_pawn_protected_knight').outposts,[{square:'d5',piece:'n',color:'w'}],'hand 1: Nd5 outpost');
// 2. Same idea but black pawn c7 (rank 7 > 5) can go c6 and attack d5: not an outpost.
eq(C('outpost_blocked_by_enemy_pawn').outposts,[],'hand 2: c7 pawn can still attack d5');
// 3. Black pawn on c5 is level with d5: it attacks b4/d4 only, can never attack d5: outpost stands.
eq(C('outpost_enemy_pawn_already_past').outposts,[{square:'d5',piece:'n',color:'w'}],'hand 3');
// 4. Classic IQP. White pawns a2 b2 d4 f2 g2 h2: d4 has no c/e neighbour -> only isolated pawn. Islands {a,b},{d},{f,g,h}=3 white; black a7 b7 e6 f7 g7 h7 -> 2.
{const c=C('isolated_queen_pawn');eq(c.pawns.w.isolated,['d4'],'hand 4 isolated');eq(c.pawns.b.isolated,[],'hand 4 black');eq([c.pawns.w.islands,c.pawns.b.islands],[3,2],'hand 4 islands');
 ok(!c.pawns.w.passed.includes('d4'),'hand 4: black e6 stands ahead on the adjacent file, so d4 is not passed');}
// 5. Lucena setup: lone white pawn b7 -> passed (no black pawns) and isolated. Files: only b has a pawn, so a,c-h open, b half-open for black.
//    Rf1 white on open f-file, Ra2 black on open a-file.
{const c=C('lucena_like_passed_pawn');eq(c.pawns.w.passed,['b7']);eq(c.pawns.w.isolated,['b7']);eq(c.files.open,['a','c','d','e','f','g','h']);
 eq(c.files.halfOpen,{w:[],b:['b']});eq(c.rooks,[{square:'f1',color:'w',file:'f',status:'open'},{square:'a2',color:'b',file:'a',status:'open'}].sort((x,y)=>x.square==='f1'?-1:1));}
// 6. X-ray battery: Rd2 attacks black pawn d5, Rd1 stands behind (x-ray), black Rd8 defends. Capture order Rd2xp (+100), Rd8xR (+500), Rd1xR (+500).
//    Backward fold: black's recapture nets 500-500=0 -> white's first capture is worth 100-0=+100.
eq(gainOf('xray_battery_wins_pawn','d5'),100,'hand 6 gain');eq(staticExchange(F.xray_battery_wins_pawn,'d5').sequence.map(s=>s.square),['d2','d8','d1'],'hand 6 order');
// 7. Same without the battery: RxP (+100) RxR (+500) and no recapture: 100-500=-400 (best=0: do not capture).
eq(gainOf('xray_missing_loses_exchange','d5'),-400,'hand 7');eq(staticExchange(F.xray_missing_loses_exchange,'d5').best,0,'hand 7 best');
// 8. Rook on open file: no pawns on d/e for either side -> open d,e; Rd1 open; Ra1 behind a2 pawn closed; black rooks a8,f8 closed.
{const c=C('rook_on_open_file');eq(c.files.open,['d','e']);eq(c.rooks.map(r=>r.square+r.status),['a1closed','d1open','a8closed','f8closed']);}
// 9. Hanging: black Ne5 attacked by pawn d4 (pawn < knight), nothing defends it (Qd8/Bf8 do not see e5): both reasons.
eq(C('hanging_by_pawn_undefended_knight').hanging,[{square:'e5',piece:'n',color:'b',attackers:1,defenders:0,reasons:['undefended','attacked_by_lower']}],'hand 9');
// 10. Rd5 is defended (c6 pawn) but attacked by the e4 pawn: hanging by the lower-attacker clause only. SEE: PxR (+500), pxP (+100) -> 400.
eq(C('hanging_defended_but_lower_attacker').hanging.map(h=>[h.square,h.reasons.join('+')]),[['d5','attacked_by_lower']],'hand 10');eq(gainOf('hanging_defended_but_lower_attacker','d5'),400,'hand 10 SEE');
// 11. c2/c3 doubled (1 extra pawn) and isolated; e2 has f2 next to it so is not isolated; islands {c},{e-h}=2.
{const p=C('doubled_isolated_c_pawns').pawns.w;eq(p.doubled,['c2','c3']);eq([p.doubledFiles,p.doubledCount,p.islands],[['c'],1,2]);eq(p.isolated,['c2','c3']);}
// 12. Backward black d6: neighbours c-file none, e5 is MORE advanced (cannot support); stop square d5 hit by white c4. a7,b7,f7,g7,h7 all have neighbours beside them.
{const c=C('backward_d6');eq(c.pawns.b.backward,['d6']);eq(c.pawns.w.backward,[]);}
// 13. King zone of g8 = f8,h8,f7,g7,h7. Qg4 hits g7 only (g-file stops at the pawn); Rf1 hits f7 only. pairs 2, weighted 5+3=8, attackers 2.
{const z=C('king_zone_queen_rook').kingZone;eq([z.b.pairs,z.b.weighted,z.b.attackers,z.b.attackedSquares],[2,8,2,['f7','g7']]);eq([z.w.pairs,z.w.weighted],[0,0]);}
// 14. Bishops c1 (dark, a1-parity) and d1 (light): a pair. 26: two dark bishops c1+e3: no pair.
eq(C('bishop_pair').bishopPair,{w:true,b:false});eq(C('same_colour_bishops').bishopPair,{w:false,b:false});
// 15. Four islands a,c,e,g all isolated.
{const p=C('four_pawn_islands').pawns.w;eq(p.islands,4);eq(p.isolated,['a2','c2','e2','g2']);}
// 16. Chain: d4,e4 side by side (phalanx); c3 attacks d4; b2 attacks c3. supported = {c3,d4}; b2 is nobody's supported pawn.
{const p=C('connected_chain').pawns.w;eq(p.phalanx,['d4','e4']);eq(p.supported,['c3','d4']);eq(p.connected,['c3','d4','e4']);
 eq(p.links,[{from:'b2',to:'c3',type:'supports'},{from:'c3',to:'d4',type:'supports'},{from:'d4',to:'e4',type:'phalanx'}]);}
// 17. RxNd5 (+320), pawn e6 retakes rook (+500), nobody left: 320-500=-180.
eq(gainOf('see_pawn_guards_knight','d5'),-180,'hand 17');
// 18. e5 pawn: white N(320) R(500) Q(900 behind R) vs black N(320) B(330) Q(900 behind B). Order N,N,R,B,Q,Q.
//     Fold from the back: Qxq... black Qh8 takes Q: V6=900. White Q: 330-max(0,900)=-570 -> 0 floor. Black Bxr: 500-0=500.
//     White Rxn: 320-500=-180 -> floor 0. Black Nxn: 320-0=320. White first NxP: 100-320=-220.
eq(gainOf('see_cpw_multi_attacker','e5'),-220,'hand 18');eq(staticExchange(F.see_cpw_multi_attacker,'e5').sequence.map(s=>s.square),['d3','d7','e2','f6','e1','h8'],'hand 18 order');
// 19. Re1 takes undefended e5 pawn: +100.
eq(gainOf('see_undefended_pawn','e5'),100);
// 20. d5 passed (no black pawn on c/d/e); a2 and a7 face each other (neither passed).
{const c=C('passed_vs_blocked');eq(c.pawns.w.passed,['d5']);eq(c.pawns.b.passed,[]);}
// 21. Half-open: white pawns a,b,c,e,f,g,h; black a,b,f,g,h. d open; c and e half-open for black (no black pawn, white has one). Re8 half-open, Rf8 closed (f7), Rc1 closed (c2).
{const c=C('half_open_file_rook');eq(c.files.open,['d']);eq(c.files.halfOpen,{w:[],b:['c','e']});eq(c.rooks.map(r=>r.square+r.status),['c1closed','e8half_open','f8closed']);}
// 22. Start position: nothing attacked; pseudo white p=8 single+8 double=16, n=2+2=4; legal 20 = 16+4.
{const c=C('start_position');eq(c.hanging,[]);eq(c.mobility.pseudo.w,{p:16,n:4,b:0,r:0,q:0,k:0});eq(c.mobility.legal,{side:'w',counts:{p:16,n:4,b:0,r:0,q:0,k:0}});ok(c.see.every(e=>e.gain===null),'start: no SEE target');}
// 23. Stalemate: black Kh8 has g8,g7,h7 pseudo destinations (Qf7 attacks all three, Kg6 covers g7,h7... ) but zero legal moves.
{const c=C('stalemate_zero_legal');eq(c.mobility.pseudo.b.k,3);eq(c.mobility.legal.counts,{p:0,n:0,b:0,r:0,q:0,k:0});}
// 24. En passant: white e5 pawn: push e6 + capture-ep d6 = 2 legal; pseudo excludes ep -> 1. King e1: d1,f1,d2,e2,f2 = 5.
{const c=C('en_passant_legal_vs_pseudo');eq(c.mobility.legal.counts.p,2);eq(c.mobility.pseudo.w.p,1);eq(c.mobility.legal.counts.k,5);}
// 25. Doubled queens on rank 1: Qa1 is shielded by Qb1 but x-rays along the rank; nothing of black's to capture. (no hanging)
eq(C('two_queens').hanging,[]);
// Legend honesty: every concept id has a label; SEE label names itself as an estimate
ok(CONCEPT_IDS.every(id=>LEGEND.concepts[id]&&LABELS[id]&&LEGEND.concepts[id].definition&&LEGEND.concepts[id].limits),'legend covers each concept');
ok(/STATIC ESTIMATE/.test(LABELS.see)&&/NOT engine/.test(LABELS.see),'SEE label is honest');
ok(/NOT mobility|not mobility/i.test(LEGEND.mobility.limits),'mobility legend distinguishes attack-count balance');
ok(conceptsReport(F.bishop_pair).legend===LEGEND,'report carries legend');
console.log('PASS hand-verified: 25 classic positions with literal reasoning-derived expectations');

// ---------------------------------------------------------------- 4. negative controls
const pick=id=>structuredClone(classics.find(f=>f.id===id));
const mutations=[
  ['SEE gain off by one',f=>{f.expected.concepts.see.find(e=>e.square==='d5').gain+=1;},'xray_battery_wins_pawn'],
  ['SEE null where attacked',f=>{f.expected.concepts.see.find(e=>e.square==='d5').gain=null;},'xray_battery_wins_pawn'],
  ['hanging piece removed',f=>{f.expected.concepts.hanging.pop();},'hanging_by_pawn_undefended_knight'],
  ['hanging reason dropped',f=>{f.expected.concepts.hanging[0].reasons.pop();},'hanging_by_pawn_undefended_knight'],
  ['isolated pawn invented',f=>{f.expected.concepts.pawns.w.isolated.push('a2');},'isolated_queen_pawn'],
  ['passed pawn removed',f=>{f.expected.concepts.pawns.w.passed.pop();},'lucena_like_passed_pawn'],
  ['doubled count wrong',f=>{f.expected.concepts.pawns.w.doubledCount=2;},'doubled_isolated_c_pawns'],
  ['backward pawn dropped',f=>{f.expected.concepts.pawns.b.backward=[];},'backward_d6'],
  ['island count wrong',f=>{f.expected.concepts.pawns.w.islands=1;},'four_pawn_islands'],
  ['outpost dropped',f=>{f.expected.concepts.outposts=[];},'outpost_pawn_protected_knight'],
  ['open file added',f=>{f.expected.concepts.files.open.push('h');},'rook_on_open_file'],
  ['rook status flipped',f=>{f.expected.concepts.rooks[1].status='closed';},'rook_on_open_file'],
  ['king-zone weight changed',f=>{f.expected.concepts.kingZone.b.weighted+=1;},'king_zone_queen_rook'],
  ['pseudo mobility +1',f=>{f.expected.concepts.mobility.pseudo.w.p+=1;},'start_position'],
  ['legal mobility +1',f=>{f.expected.concepts.mobility.legal.counts.n+=1;},'start_position'],
  ['bishop pair flipped',f=>{f.expected.concepts.bishopPair.w=false;},'bishop_pair'],
  ['squares list corrupted',f=>{f.expected.squares.hanging.push('a1');},'hanging_by_pawn_undefended_knight'],
  ['link type changed',f=>{f.expected.concepts.pawns.w.links[0].type='phalanx';},'connected_chain'],
  ['wrong FEN attached to expectations',f=>{f.fen=F.bishop_pair;},'xray_battery_wins_pawn'],
];
for(const [name,mutate,id] of mutations){
  const clean=pick(id);eq(compareFixture(clean),[],'control precondition for '+name);
  const bad=pick(id);mutate(bad);ok(compareFixture(bad).length>0,'mutation NOT detected: '+name);
}
// the same detection on a random fixture, mutating every concept family
{const f=pick('xray_battery_wins_pawn');void f;
 const r=structuredClone(randoms[7]);eq(compareFixture(r),[]);r.expected.concepts.mobility.pseudo.b.q+=1;ok(compareFixture(r).length>0,'random-fixture mutation detected');}
// the fixture FILE: flipping one byte of the text changes parse result or breaks regeneration equality
{const broken=fixtureText.replace('"gain":100','"gain":101');ok(broken!==fixtureText,'fixture has a gain 100 to corrupt');
 ok(JSON.parse(broken).positions.some(p=>compareFixture(p).length>0),'corrupted fixture file produces disagreements');ok(broken!==fixtureText,'byte-compare would catch it');}
for(const bad of['','not a fen','8/8/8/8/8/8/8/8 w - - 0 1','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1',null,42])
  assert.throws(()=>conceptsReport(bad),RangeError,'bad FEN must be refused: '+bad);checks+=6;
for(const bad of['i9','e0','',null,'E4','e44'])assert.throws(()=>staticExchange(F.start_position,bad),RangeError);checks+=6;
assert.throws(()=>staticExchange(F.start_position,'e4'),/No piece/);checks++;               // empty square
assert.throws(()=>staticExchange(F.start_position,'e1'),/king/);checks++;                    // king target
eq(staticExchange(F.start_position,'e2').gain,null,'unattacked piece has no exchange');
assert.throws(()=>conceptGeometry(R('bishop_pair'),[0,0,0],['nonsense']),RangeError);
assert.throws(()=>conceptGeometry(R('bishop_pair'),[0,NaN,0],null),RangeError);
assert.throws(()=>conceptGeometry({concepts:{},squares:{}},[0,0,0],null)); // malformed report (no files/pawns)
assert.throws(()=>conceptGeometry(null,[0,0,0]),RangeError);
{const bad=structuredClone(R('hanging_by_pawn_undefended_knight'));bad.squares.hanging=['z9'];assert.throws(()=>conceptGeometry(bad,[0,0,0],['hanging']),RangeError);}
assert.throws(()=>conceptsXml([0,0,0],{prefix:"x' onload='y"}),RangeError);
checks+=7;
console.log('PASS negative controls: '+mutations.length+' mutated fixtures detected, malformed FEN/square/selection/report/prefix refused');

// ---------------------------------------------------------------- 5. geometry
const O=[10,0,20];
{
  const rep=R('hanging_by_pawn_undefended_knight'),g=conceptGeometry(rep,O,['hanging']);
  // e5: file e=4 -> x=10+4-3.5=10.5 ; rank 5 -> z=20+3.5-4=19.5
  eq(g.primitives.length,1);const p=g.primitives[0];eq([p.kind,p.square,p.center[0],p.center[2]],['ring','e5',10.5,19.5],'ring centre by hand arithmetic');
  const pts=g.buffers.hanging.lines.points;eq(pts.length,16);
  ok(pts.every(q=>Math.abs(Math.hypot(q[0]-10.5,q[2]-19.5)-0.45)<1e-9&&q[1]===p.center[1]),'ring points lie on the circle');
  eq(g.buffers.hanging.lines.index,[...Array.from({length:16},(_,i)=>i),0,-1],'ring polyline closes');
  ok(CONCEPT_IDS.filter(id=>id!=='hanging').every(id=>g.buffers[id].lines.points.length===0&&g.buffers[id].faces.points.length===0),'unselected concepts are empty');
  // corners: a1 at (6.5,23.5), h8 at (13.5,16.5)
  const rr={...rep,squares:{...rep.squares,hanging:['a1','h8']}},g2=conceptGeometry(rr,O,['hanging']);
  eq([g2.primitives[0].center[0],g2.primitives[0].center[2],g2.primitives[1].center[0],g2.primitives[1].center[2]],[6.5,23.5,13.5,16.5],'corner squares');
}
{ // every concept on a rich position: counts must equal the report
  const rep=R('greek_gift_shape'),g=conceptGeometry(rep,[0,0,0],null);
  const n=k=>g.primitives.filter(p=>p.concept===k).length;
  for(const id of['hanging','see','isolated','doubled','passed','backward','outpost','rookFile','kingZone','bishopPair'])eq(n(id),rep.squares[id].length,'primitive count '+id);
  eq(n('connected'),rep.concepts.pawns.w.links.length+rep.concepts.pawns.b.links.length);
  eq(n('openFiles'),rep.concepts.files.open.length);
  for(const id of CONCEPT_IDS){const b=g.buffers[id];
    for(const part of['lines','faces']){const {points,index}=b[part];
      ok(points.every(q=>q.length===3&&q.every(Number.isFinite)),'finite coordinates '+id);
      ok(index.every(i=>i===-1||(Number.isInteger(i)&&i>=0&&i<points.length)),'index in range '+id);
      ok(index.length===0||index[index.length-1]===-1,'index terminated '+id);}}
  // strips: d-file in lucena at origin (0,0,0): x=3-3.5=-0.5 +-0.46
  const lg=conceptGeometry(R('lucena_like_passed_pawn'),[0,0,0],['openFiles']),d=lg.buffers.openFiles.faces.points;
  eq(d.length,7*4,'seven open files x 4 corners');
  ok(d.some(q=>Math.abs(q[0]-(-0.5-0.46))<1e-9)&&d.some(q=>Math.abs(q[0]-(-0.5+0.46))<1e-9),'d-file strip x extents');
  ok(lg.primitives.every(p=>p.zFrom===-3.95&&p.zTo===3.95),'strip spans the board in z');
  // links: connected_chain has 3 links, each 2 points
  const cg=conceptGeometry(R('connected_chain'),[0,0,0],['connected']);eq(cg.buffers.connected.lines.points.length,6);
  // b2 (x=-2.5,z=2.5) -> c3 (x=-1.5, z=1.5)
  eq([cg.buffers.connected.lines.points[0][0],cg.buffers.connected.lines.points[0][2],cg.buffers.connected.lines.points[1][0],cg.buffers.connected.lines.points[1][2]],[-2.5,2.5,-1.5,1.5],'link endpoints');
  // determinism and selection filtering
  eq(JSON.stringify(conceptGeometry(rep,[0,0,0],null)),JSON.stringify(g),'geometry is deterministic');
  ok(conceptGeometry(rep,[0,0,0],[]).primitives.length===0,'empty selection draws nothing');
}

// updates <-> DEF names
{
  const rep=R('greek_gift_shape'),g=conceptGeometry(rep,O,['hanging','kingZone','openFiles']),ups=conceptUpdates(g,{prefix:'cxA'});
  eq(ups.length,CONCEPT_IDS.length*5);
  const xml=conceptsXml(O,{prefix:'cxA'}),defs=new Set([...xml.matchAll(/DEF='([^']+)'/g)].map(m=>m[1]));
  ok(ups.every(u=>defs.has(u.def)),'every update targets a DEF in conceptsXml');
  const vis=Object.fromEntries(ups.filter(u=>u.field==='visible').map(u=>[u.def,u.value]));
  eq(vis.cxA_kingZone,g.buffers.kingZone.lines.points.length>0);eq(vis.cxA_passed,false);
  ok(ups.every(u=>u.field==='visible'?typeof u.value==='boolean':Array.isArray(u.value)&&u.value.length>0),'updates well formed');
  ok((xml.match(/pointerEvents='false'/g)||[]).length===CONCEPT_IDS.length*2&&(xml.match(/<Shape\b/g)||[]).length===CONCEPT_IDS.length*2,'every shape has pointerEvents=false');
  ok(!/^\s*<\?xml/.test(xml)&&/profile='Interchange' version='4.0'/.test(xml),'X3D 4.0 Interchange');
  ok(/<component name='Rendering'/.test(xml)&&/<component name='Shape'/.test(xml)&&/<component name='Grouping'/.test(xml),'explicit components');
  assert.throws(()=>conceptUpdates({}),RangeError);checks++;
}

// X3D validation with the pinned validator on a minimal full document per fragment
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'concepts-x3d-'));
  const docs={};
  const wrapPortable=(xml,name)=>projectPortableX3D(xml,{title:'Concept lens: '+name,metadata:{scope:'concepts.js fragment; geometry syntax only, no chess claim'}});
  docs.empty=wrapPortable(conceptsXml([0,0,0]),'empty');
  for(const id of['greek_gift_shape','connected_chain','lucena_like_passed_pawn','hanging_by_pawn_undefended_knight','king_zone_queen_rook','outpost_pawn_protected_knight','half_open_file_rook']){
    const g=conceptGeometry(R(id),[0,0,0],null);docs[id]=wrapPortable(conceptsXml([0,0,0],{buffers:g.buffers,selected:null}),id);
  }
  {const g=conceptGeometry(R('greek_gift_shape'),[20,0,-10],['hanging','kingZone']);docs.subset=wrapPortable(conceptsXml([20,0,-10],{prefix:'cx7',buffers:g.buffers,selected:g.selected}),'subset');
   ok(/DEF='cx7_passed' visible='false'/.test(docs.subset.xml),'unselected group hidden');ok(!/DEF='cx7_hanging' visible='false'/.test(docs.subset.xml)||g.buffers.hanging.lines.points.length===0,'selected group visible');}
  for(const [name,d] of Object.entries(docs)){ok(d.losses[0]?.records===CONCEPT_IDS.length*2,'projection removed pointerEvents from every shape ('+name+')');ok(!/pointerEvents/.test(d.xml),'portable has no X_ITE field');}
  const files=Object.entries(docs).map(([name,d])=>{const f=path.join(dir,'concepts-'+name+'.x3d');fs.writeFileSync(f,d.xml);return f;});
  const out=path.join(dir,'report.json');
  const run=spawnSync(PY,[path.join(ROOT,'tools/validate_x3d.py'),'--output',out,...files],{encoding:'utf8'});
  const rep=JSON.parse(fs.readFileSync(out,'utf8'));
  const failing=rep.files.filter(f=>f.status!=='pass').map(f=>f.path+': '+JSON.stringify([f.xsd.findings,f.semantic.findings]).slice(0,400));
  if(failing.length)console.error(failing.join('\n'));
  eq(failing,[],'every concept fragment validates (XSD 4.0 + semantic)');ok(run.status===0,'validator exit 0 (controls included): '+run.stdout+run.stderr);
  eq(rep.files.length,files.length);
  // negative control: corrupt numbers / structure must be rejected by the same instrument
  const bads={coordIndex:docs.greek_gift_shape.xml.replace(/coordIndex='0 1/,"coordIndex='zero 1"),
    point:docs.greek_gift_shape.xml.replace(/point='-?[\d.]+ /,"point='bad "),
    unknownNode:docs.empty.xml.replace('<IndexedLineSet','<IndexedLineSetX')};
  const badFiles=Object.entries(bads).map(([n,x])=>{ok(x!==docs.greek_gift_shape.xml||n==='unknownNode','mutation applied: '+n);const f=path.join(dir,'bad-'+n+'.x3d');fs.writeFileSync(f,x);return f;});
  const brun=spawnSync(PY,[path.join(ROOT,'tools/validate_x3d.py'),'--output',path.join(dir,'bad.json'),...badFiles],{encoding:'utf8'});
  const brep=JSON.parse(fs.readFileSync(path.join(dir,'bad.json'),'utf8'));
  ok(brun.status!==0&&brep.files.every(f=>f.status!=='pass'),'corrupted X3D fragments are rejected by the validator: '+brep.files.map(f=>f.status));
  console.log('PASS geometry + X3D: '+files.length+' fragments validated by the pinned XSD/semantic instrument, '+badFiles.length+' corrupted fragments rejected');
  fs.rmSync(dir,{recursive:true,force:true});
}

// ---------------------------------------------------------------- 6. review additions (regressions + metamorphic checks)
{
  // flags must stay inside their own square (|dx|,|dz| < 0.5): the old pennant spilled 0.16 off the h-file and into the neighbour's flag pole
  const rich=['greek_gift_shape','isolated_queen_pawn','doubled_isolated_c_pawns','backward_d6','hanging_by_pawn_undefended_knight','xray_battery_wins_pawn'];
  let flags=0;
  const everyFlagSquare=conceptGeometry({...R('start_position'),squares:Object.fromEntries(CONCEPT_IDS.map(id=>[id,['a1','h1','a8','h8','d4']]))},[0,0,0],['see','isolated','doubled','backward']);
  for(const p of everyFlagSquare.primitives){flags++;
    const [x,z]=[p.base[0],p.base[2]],c=p.square.charCodeAt(0)-97-3.5,r=3.5-(Number(p.square[1])-1);ok(Math.abs(x-c)<0.5&&Math.abs(z-r)<0.5,'flag pole inside square '+p.square);}
  for(const q of Object.values(everyFlagSquare.buffers).flatMap(b=>b.faces.points))ok(q[0]>=-4&&q[0]<=4&&q[2]>=-4&&q[2]<=4,'every flag vertex lies on the board');
  // a1 corner flag 0 (SEE) at x=-3.5+0.36: tip must be at x<=pole, never beyond +0.5 of the square centre
  const g=conceptGeometry({...R('start_position'),squares:{...R('start_position').squares,see:['h1']}},[0,0,0],['see']);
  ok(g.buffers.see.faces.points.every(q=>q[0]<=3.5+0.36+1e-9&&q[0]>=3.5-0.5),'h1 SEE pennant stays on the board (x<=3.86, no spill past 4.0)');
  ok(flags===4*5,'flag primitives counted '+flags);
  for(const id of rich)void conceptGeometry(R(id),[0,0,0],null);
  // malformed buffers / selection are RangeErrors, not TypeErrors or silently-invalid XML
  const g0=conceptGeometry(R('bishop_pair'),[0,0,0],null);
  assert.throws(()=>conceptUpdates({buffers:{},selected:[]}),RangeError);
  assert.throws(()=>conceptUpdates({buffers:{...g0.buffers,hanging:{lines:{points:[[0,0]],index:[]},faces:{points:[],index:[]}}},selected:[]}),RangeError);
  assert.throws(()=>conceptsXml([0,0,0],{buffers:{...g0.buffers,see:{lines:{points:[[0,0,0]],index:[5,-1]},faces:{points:[],index:[]}}}}),RangeError);
  assert.throws(()=>conceptsXml([0,0,0],{buffers:g0.buffers,selected:['bogus']}),RangeError);
  assert.throws(()=>conceptsXml([0,0,0],{buffers:g0.buffers,selected:'hanging'}),RangeError);
  checks+=5;
  // the documented clear path (empty selection on a real report) works; the old advice (an empty hand-made report) is refused
  const cl=conceptUpdates(conceptGeometry(R('greek_gift_shape'),O,[]),{prefix:'cx0'});
  ok(cl.filter(u=>u.field==='visible').every(u=>u.value===false)&&cl.filter(u=>u.field==='point').every(u=>u.value.length===1),'empty selection hides and empties every group');
  // integration header must describe the ASYNC creation (createX3DFromString is a promise in board.js)
  const hdr=fs.readFileSync(path.join(ROOT,'viewer/js/concepts.js'),'utf8').split('\nimport ')[0];
  ok(/ASYNC/.test(hdr)&&/await this\.conceptPromise/.test(hdr)&&!/const cx = createX3DFromString/.test(hdr),'integration notes use the async creation pattern');
}
{ // metamorphic checks independent of the oracle: colour-flip and file-mirror symmetry over seeded random games (same chess.js the module uses)
  const {Chess}=await import('../viewer/vendor/chess.js');
  let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  const flipC=f=>{const [b,t,c]=f.split(' ');return [b.split('/').reverse().map(r=>[...r].map(ch=>/[a-z]/.test(ch)?ch.toUpperCase():ch.toLowerCase()).join('')).join('/'),t==='w'?'b':'w',c==='-'?'-':[...c].map(x=>x===x.toUpperCase()?x.toLowerCase():x.toUpperCase()).join(''),'-','0','1'].join(' ');};
  const mirrorF=f=>{const [b,t]=f.split(' ');return [b.split('/').map(r=>[...r].reverse().join('')).join('/'),t,'-','-','0','1'].join(' ');};
  const fl=s=>s[0]+(9-s[1]),mf=s=>String.fromCharCode(201-s.charCodeAt(0))+s[1];
  const key=s=>(s[1]-1)*8+s.charCodeAt(0)-97,norm=a=>a.slice().sort((x,y)=>key(x)-key(y));
  let n=0;
  for(let g=0;g<120;g++){const ch=new Chess();let k=0;
    while(!ch.isGameOver()&&k<120){const m=ch.moves();ch.move(m[Math.floor(rnd()*m.length)]);k++;
      if(k%9!==0)continue;const fen=ch.fen(),a=conceptsReport(fen).concepts,b=conceptsReport(flipC(fen)).concepts,c=conceptsReport(mirrorF(fen)).concepts;n++;
      const sig=(r,t)=>({h:norm(r.hanging.map(x=>t(x.square)+x.reasons)),see:norm(r.see.map(x=>t(x.square)+':'+x.gain)),o:norm(r.outposts.map(x=>t(x.square)))});
      // colour flip: squares reflect in rank, colours swap
      eq(norm(a.hanging.map(x=>x.square+x.reasons.join())).length,a.hanging.length);
      eq(sig(a,fl).h.map(x=>x),norm(b.hanging.map(x=>x.square+x.reasons)),'colour-flip hanging '+fen);
      eq(sig(a,fl).see,norm(b.see.map(x=>x.square+':'+x.gain)),'colour-flip SEE '+fen);
      eq(sig(a,fl).o,norm(b.outposts.map(x=>x.square)),'colour-flip outposts '+fen);
      for(const [c1,c2] of [['w','b'],['b','w']])for(const q of['isolated','doubled','passed','backward','phalanx','supported'])
        eq(norm(a.pawns[c1][q].map(fl)),b.pawns[c2][q],'colour-flip '+q+' '+fen);
      eq([a.kingZone.w.weighted,a.kingZone.b.pairs,a.mobility.pseudo.w],[b.kingZone.b.weighted,b.kingZone.w.pairs,b.mobility.pseudo.b],'colour-flip zone/mobility '+fen);
      // file mirror: every file-symmetric rule must give the mirrored answer
      eq(sig(a,mf).h,norm(c.hanging.map(x=>x.square+x.reasons)),'mirror hanging '+fen);
      eq(sig(a,mf).see,norm(c.see.map(x=>x.square+':'+x.gain)),'mirror SEE '+fen);
      for(const col of['w','b'])for(const q of['isolated','doubled','passed','backward','phalanx','supported'])
        eq(norm(a.pawns[col][q].map(mf)),c.pawns[col][q],'mirror '+q+' '+fen);
      eq(norm(a.outposts.map(x=>mf(x.square))),norm(c.outposts.map(x=>x.square)),'mirror outposts '+fen);
      eq([a.mobility.pseudo.w,a.mobility.pseudo.b,a.bishopPair],[c.mobility.pseudo.w,c.mobility.pseudo.b,c.bishopPair],'mirror mobility '+fen);
    }}
  ok(n>=400,'symmetry positions checked: '+n);
  console.log('PASS review additions: flag/pennant bounds, buffer/selection validation, clear path, async integration notes, '+n+' colour-flip + file-mirror symmetry positions');
}

console.log(JSON.stringify({status:'pass',checks,positions:fixtures.positions.length,oracle:fixtures.oracle}));
