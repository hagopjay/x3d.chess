// Known-answer tests for viewer/js/skyline.js. Expected values are derived by hand or from python-chess
// (CHESS_TEST_PYTHON), never by pasting the module's own output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {SKY,LEGEND,normalizeScore,skylineLayout,skylineState,skylineUpdate,skylineReset,skylinePoints,skylineHeight,skylineXml,ribbonPoints,ribbonXml,groupFlat} from '../viewer/js/skyline.js';
import {gridLayout} from '../viewer/js/layout.js';
import {projectPortableX3D} from '../viewer/js/export.js';
const PY=process.env.CHESS_TEST_PYTHON||'python3';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
let checks=0;const ok=(c,m)=>{assert(c,m);checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const near=(a,b,m)=>{assert(Math.abs(a-b)<1e-9,`${m||''} ${a} !~ ${b}`);checks++;};
const rec=(cp,extra={})=>({evaluation_kind:'engine_cp',eval_cp:cp,mate_in:null,score_bound:'exact',eval_fen:null,eval_ply:null,...extra});
const mate=(m,extra={})=>({evaluation_kind:'engine_mate',eval_cp:null,mate_in:m,score_bound:'exact',...extra});
const NOSCORE={evaluation_kind:'unavailable',eval_cp:null,mate_in:null,score_bound:null};
const stateFor=n=>skylineState(skylineLayout(gridLayout({boards:n}),n));
const one=(rec_,i=0,n=1)=>{const st=stateFor(n);assert(skylineUpdate(st,i,rec_,0,0).accepted);return {st,u:skylinePoints(st)};};
const colFace=(u,i,f)=>u.colors.slice((i*5+f)*4,(i*5+f)*4+4);
const capY=(u,i)=>u.points[(i*8+4)*3+1];       // ring B vertex 0 y
const baseRingY=(u,i)=>u.points[(i*8)*3+1];

// 1. layouts: hand-derived origins (cols=min(5,n), rows=ceil(n/cols), pitch 10) and footprint containment.
for(const n of [1,5,6,20,21,64]){
  const g=gridLayout({boards:n}),sl=skylineLayout(g,n),cols=Math.min(5,n),rows=Math.ceil(n/cols);
  eq(sl.columns.length,n,'count '+n);
  sl.columns.forEach((c,i)=>{
    const ox=((i%cols)-(cols-1)/2)*10,oz=(Math.floor(i/cols)-(rows-1)/2)*10;
    eq(c.origin,[ox,0,oz],`origin ${n}/${i}`);eq(c.center,[ox,oz]);
    ok(c.footprint.xmin>=ox-4&&c.footprint.xmax<=ox+4&&c.footprint.zmin>=oz-4&&c.footprint.zmax<=oz+4,`inside board ${n}/${i}`);
    ok(c.labelPos[1]>sl.baseY+sl.maxH,'label above tallest column');
  });
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){const A=sl.columns[a].footprint,B=sl.columns[b].footprint;
    ok(A.xmax<=B.xmin||B.xmax<=A.xmin||A.zmax<=B.zmin||B.zmax<=A.zmin,`no overlap ${n}:${a},${b}`);}
}
{ // partial last row, hand: n=6 -> board 5 is first of row 2: x=(0-2)*10=-20, z=(1-0.5)*10=5; n=21: rows=5, last board 20 at x=-20,z=(4-2)*10=20
  eq(skylineLayout(gridLayout({boards:6}),6).columns[5].origin,[-20,0,5]);
  eq(skylineLayout(gridLayout({boards:21}),21).columns[20].origin,[-20,0,20]);
  const g8=gridLayout({boards:64,cols:8,pitch:9}),s8=skylineLayout(g8,64);
  s8.columns.forEach(c=>ok(c.footprint.xmax<=c.origin[0]+4&&c.footprint.zmin>=c.origin[2]-4));
  eq(skylineLayout(gridLayout({boards:20}),7).columns.length,7);}
assert.throws(()=>skylineLayout(gridLayout({boards:5}),6),/exceeds/);
assert.throws(()=>skylineLayout(gridLayout({boards:5}),0),/1 to 64/);
assert.throws(()=>skylineLayout(gridLayout({boards:5}),65),/1 to 64/);
assert.throws(()=>skylineLayout({origins:[[0,0,NaN]]},1),/invalid/);checks+=4;

// 2. height curve (hand: 0.4 per pawn, saturating at 6 pawns = 2.4) and clipping
near(skylineHeight(100),0.4);near(skylineHeight(250),1.0);near(skylineHeight(-300),-1.2);near(skylineHeight(600),2.4);
near(skylineHeight(1500),2.4);near(skylineHeight(-99999),-2.4);near(skylineHeight(0),0);
assert.throws(()=>skylineHeight(NaN),/finite/);checks++;
{const {u}=one(rec(250));near(baseRingY(u,0),4.0);near(capY(u,0),5.0);eq(u.details[0].clipped,false);eq(u.labels[0],'+2.5');
 const w=one(rec(-300)).u;near(capY(w,0),4-1.2);eq(w.labels[0],'-3.0');
 const e=one(rec(600)).u;near(capY(e,0),6.4);eq(e.details[0].clipped,false);
 const c=one(rec(601)).u,d=one(rec(100000)).u;near(capY(c,0),6.4);near(capY(d,0),6.4);eq(d.details[0].clipped,true);
 eq(colFace(c,0,0),[1,0.6,0.1,0.85],'clip cap amber');eq(colFace(e,0,0).slice(0,3),[0.1,0.9,1],'600 not clipped');
 ok(/clip/.test(d.labels[0]));ok(/100000|1000\.0/.test(d.labels[0]),'label keeps the reported value');
 const neg=one(rec(-100000)).u;near(capY(neg,0),1.6);eq(colFace(neg,0,0).slice(0,3),[1,0.6,0.1]);eq(colFace(neg,0,1).slice(0,3),[1,0.2,0.8],'sides keep sign tint');
 // tint by perspective: white ahead cyan, black ahead magenta
 eq(colFace(u,0,1).slice(0,3),[0.1,0.9,1]);eq(colFace(w,0,1).slice(0,3),[1,0.2,0.8]);
 // exact zero: hairline slab at full width, not the 'no score' marker
 const z=one(rec(0)).u;near(capY(z,0)-baseRingY(z,0),SKY.MIN_H);eq(z.details[0].kind,'cp');eq(z.labels[0],'+0.0'.replace('+',''));
 // vertices lie in the board footprint horizontally
 for(let k=0;k<8;k++){ok(Math.abs(u.points[k*3])<=0.9+1e-9&&Math.abs(u.points[k*3+2])<=0.9+1e-9);}
}
// 3. null / mate / bound render separately
{const nul=one(null).u,unav=one(NOSCORE).u,zero=one(rec(0)).u,mt=one(mate(3)).u,mtb=one(mate(-2)).u,hol=one(rec(150,{score_bound:'lowerbound'})).u,sol=one(rec(150)).u;
 eq(nul.details[0].kind,'none');eq(unav.details[0].kind,'none');eq(nul.labels[0],'no score');
 eq(skylinePoints(stateFor(1)).details[0].kind,'none','fresh board is no-score, not zero');
 // null slab: narrow (0.4 half), centred on baseline, grey; zero: full 0.9 width hairline
 near(nul.points[0],-0.4);near(zero.points[0],-0.9);near(baseRingY(nul,0),4-0.15);near(capY(nul,0),4+0.15);
 eq(colFace(nul,0,0),[0.6,0.6,0.65,0.45]);ok(nul.points.join()!==zero.points.join());ok(nul.colors.join()!==zero.colors.join());
 // mate: typed, full clip height, flat ivory/violet cap, glyph label; huge eval_cp ignored
 near(capY(mt,0),6.4);eq(colFace(mt,0,0),[1,1,0.85,0.85]);eq(mt.labels[0],'+M3');eq(mt.details[0].mate,3);eq(mt.details[0].cp,null);
 near(capY(mtb,0),1.6);eq(colFace(mtb,0,0),[0.6,0.3,1,0.85]);eq(mtb.labels[0],'-M2');
 const big=one(mate(3,{eval_cp:32000})).u;eq(big.points,mt.points);eq(big.colors,mt.colors);
 // mate differs from a clipped centipawn score of the same height
 ok(colFace(mt,0,0).join()!==colFace(one(rec(9999)).u,0,0).join());
 // bound: hollow = near-transparent faces + opaque outline; exact = solid and outline transparent
 eq(hol.details[0].hollow,true);ok(colFace(hol,0,1)[3]<=0.1+1e-12);ok(colFace(hol,0,0)[3]<=0.14+1e-12);
 eq(hol.outlineColors.slice(0,4),[0.1,0.9,1,1]);eq(hol.outlineColors.length,6*4);
 eq(sol.details[0].hollow,false);eq(sol.outlineColors.slice(0,4),[0,0,0,0]);ok(colFace(sol,0,1)[3]>=0.5);
 ok(/LB/.test(hol.labels[0]));ok(/UB/.test(one(rec(-50,{score_bound:'upperbound'})).u.labels[0]));ok(/bound\?/.test(one(rec(50,{score_bound:'unknown'})).u.labels[0]));
 eq(one(rec(150,{score_bound:'upperbound'})).u.details[0].bound,'upperbound');
 const mh=one(mate(1,{score_bound:'lowerbound'})).u;eq(mh.details[0].hollow,true);ok(/\+M1 LB/.test(mh.labels[0]));
 eq(mh.outlineColors.slice(4,8),[1,1,0.85,1],'hollow mate keeps ivory cap outline');
 // material proxy: own palette and label, never hollow, bound must be absent
 const px=one({evaluation_kind:'material_proxy',eval_cp:200,mate_in:null,score_bound:null}).u;eq(px.labels[0],'+2.0 mat');eq(colFace(px,0,1).slice(0,3),[0.6,0.9,0.35]);eq(px.details[0].kind,'proxy');
 eq(normalizeScore({evaluation_kind:'material_proxy',eval_cp:100,score_bound:'exact'}).ok,false);
 // identity travels through to details
 const fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
 const id=one(rec(30,{eval_fen:fen,eval_ply:1})).u.details[0];eq([id.fen,id.ply],[fen,1]);}
// one SINGLE column set: mixed state, many boards, geometry sizes
{const st=stateFor(21);[rec(10),mate(4),null,rec(-700),rec(5,{score_bound:'unknown'})].forEach((r,i)=>skylineUpdate(st,i,r,0,0));
 const u=skylinePoints(st);eq([u.points.length,u.colors.length,u.outlineColors.length,u.labels.length],[21*24,21*20,21*24,21]);
 ok([...u.points,...u.colors,...u.outlineColors].every(Number.isFinite));ok(u.colors.every(c=>c>=0&&c<=1));
 eq(u.details.map(d=>d.kind).slice(0,5),['cp','mate','none','cp','cp']);}

// 4. stale rejection and the out-of-order negative control
{const st=stateFor(3),acc=(i,r,g,s)=>skylineUpdate(st,i,r,g,s);
 eq(acc(0,rec(100),1,5).accepted,true);const rev=st.revision,before=JSON.stringify(skylinePoints(st));
 let r=acc(0,rec(-900),1,3);eq([r.accepted,r.reason],[false,'stale_seq']);              // NEGATIVE CONTROL: out-of-order seq ignored
 r=acc(0,rec(-900),1,5);eq([r.accepted,r.reason],[false,'stale_seq']);                  // duplicate
 r=acc(0,rec(-900),0,99);eq([r.accepted,r.reason],[false,'stale_generation']);          // older generation, high seq
 eq(st.revision,rev);eq(JSON.stringify(skylinePoints(st)),before,'rejected updates change nothing');
 eq(st.slots[0].seq,5);eq(st.slots[0].generation,1);
 eq(acc(0,rec(-200),1,6).accepted,true);eq(skylinePoints(st).details[0].cp,-200);
 eq(acc(0,rec(40),2,0).accepted,true,'newer generation restarts seq');eq(acc(0,rec(-900),1,50).accepted,false);eq(acc(0,rec(60),2,0).accepted,false);
 // malformed does not advance guards: a later valid seq is still accepted
 r=acc(1,rec(NaN),0,10);eq(r.accepted,false);ok(/malformed/.test(r.reason));eq(st.slots[1].seq,-1);eq(acc(1,rec(10),0,1).accepted,true);
 // newer-generation 'no score' clears the stale score
 eq(acc(0,null,3,0).accepted,true);eq(skylinePoints(st).details[0].kind,'none');
 // boards are independent
 eq(acc(2,rec(77),0,0).accepted,true);eq(acc(2,rec(78),0,0).accepted,false);
 for(const [i,g,s] of [[-1,0,0],[3,0,0],[1.5,0,0],[0,-1,0],[0,0,-1],[0,0.5,0],[0,'1',0]])eq(acc(i,rec(1),g,s).accepted,false,`bad ${i} ${g} ${s}`);
 skylineReset(st);eq(skylinePoints(st).details.every(d=>d.kind==='none'),true);eq(acc(2,rec(1),0,0).accepted,false,'reset keeps guards');
 skylineReset(st,{guards:true});eq(acc(2,rec(1),0,0).accepted,true);}
// corrupted records are rejected, each with a reason
for(const [name,r] of [['kind',{...rec(1),evaluation_kind:'wild'}],['cp string',rec('12')],['cp inf',rec(Infinity)],['bound',rec(1,{score_bound:'maybe'})],['fen type',rec(1,{eval_fen:5})],['fen short',rec(1,{eval_fen:'8/8'})],
  ['ply',rec(1,{eval_ply:-1})],['ply float',rec(1,{eval_ply:1.5})],['mate0',mate(0)],['mate null',mate(null)],['mate float',mate(1.5)],['cp+mate',rec(1,{mate_in:2})],['unavailable+cp',{evaluation_kind:'unavailable',eval_cp:5}],
  ['missing kind',{eval_cp:5}],['array',[1]],['string','x']]){
  const n=normalizeScore(r);eq(n.ok,false,name);ok(/^malformed/.test(n.reason),name);}

// 5. ribbon. step = 8/59 (hand: 60 slots across the 8-unit board width)
const O=[3,0,-2],STEP=8/59,X0=O[0]-4,Z=O[2]-4.4,BASE=1.6;
const xOf=i=>X0+i*STEP;
{ // gap: [100,200,null,300,400] -> two runs, two quads, nothing spans slot 2
 const r=ribbonPoints([rec(100),rec(200),null,rec(300),rec(400)],O);
 eq(r.runs,[[0,1],[3,4]]);eq(r.gaps,[2]);eq(r.faces.length,2);eq(r.faces.map(f=>f.slots),[[0,1],[3,4]]);
 const P=groupFlat(r.points,3);
 for(const p of P){ok(p[0]<=xOf(1)+1e-9||p[0]>=xOf(3)-1e-9,'no vertex inside the gap');near(p[2],Z);}
 near(P[2][1],BASE+0.2);near(P[3][1],BASE+0.1);near(P[6][1],BASE+0.4);       // y=BASE+cp/100*0.1
 eq(r.coordIndex,[0,1,2,3,-1,4,5,6,7,-1]);eq(r.colors.length,8);
 // unavailable record behaves like null
 eq(ribbonPoints([rec(100),NOSCORE,rec(100)],O).faces.map(f=>f.type),['tick','tick']);}
{ // mate separated: [100, mate+3, 200]: two ticks + one mate bar, no segment, never interpolated
 const r=ribbonPoints([rec(100),mate(3),rec(200)],O);
 eq(r.faces.map(f=>f.type),['tick','mate','tick']);eq(r.mates,[1]);eq(r.faces.filter(f=>f.type==='segment').length,0);
 eq(r.colors.slice(4,7),[1,1,0.85]);const P=groupFlat(r.points,3);near(P[6][1],BASE+0.6,'mate bar fixed at clip height');
 near(ribbonPoints([mate(-1)],O).points[7],BASE-0.6);
 ok(P.slice(4,8).every(p=>Math.abs(p[0]-xOf(1))<STEP*0.31),'mate bar centred on its slot');
 eq(ribbonPoints([rec(100),mate(2,{eval_cp:99999}),rec(100)],O).points.length,36);}
{ // kind change breaks the line
 const r=ribbonPoints([rec(100),{evaluation_kind:'material_proxy',eval_cp:100,mate_in:null},rec(100)],O);eq(r.faces.map(f=>f.type),['tick','tick','tick']);eq(r.runs,[[0,0],[1,1],[2,2]]);}
{ // sign change split at the zero crossing (hand: cp +100 -> -100 crosses at the slot midpoint)
 const r=ribbonPoints([rec(100),rec(-100)],O);eq(r.faces.length,2);eq(r.colors.slice(0,3),[0.1,0.9,1]);eq(r.colors.slice(4,7),[1,0.2,0.8]);
 const P=groupFlat(r.points,3);near(P[1][0],xOf(0)+STEP/2);near(P[3][0],xOf(0)+STEP/2);eq(r.coordIndex,[0,1,2,-1,3,4,5,-1]);
 // asymmetric crossing: +300 -> -100 crosses at 3/4 of the step
 near(groupFlat(ribbonPoints([rec(300),rec(-100)],O).points,3)[1][0],xOf(0)+STEP*0.75);}
{ // clipping and hollow bound
 const r=ribbonPoints([rec(5000),rec(-5000)],O),P=groupFlat(r.points,3);near(P[2][1],BASE+0.6);ok(P.every(p=>p[1]>=BASE-0.6-1e-9&&p[1]<=BASE+0.6+1e-9));
 const h=ribbonPoints([rec(100,{score_bound:'unknown'}),rec(100)],O),s=ribbonPoints([rec(100),rec(100)],O);ok(h.colors[3]<s.colors[3]);}
{ // window: only the last 60 plies, x within the board width, 59 joined faces
 const hist=Array.from({length:75},(_,i)=>rec(i));const r=ribbonPoints(hist,O);
 eq(r.window,{start:15,end:75,length:60});eq(r.faces.length,59);eq(r.runs,[[0,59]]);
 near(Math.min(...r.points.filter((_,i)=>i%3===0)),X0);near(Math.max(...r.points.filter((_,i)=>i%3===0)),X0+8);
 near(groupFlat(r.points,3)[2][1],BASE+0.16*0+ (15+1)/100*0.1,'first window sample is ply 15 -> second sample cp 16');
 eq(ribbonPoints([],O).faces.length,0);eq(ribbonPoints([null,null],O).points.length,0);
 ok(ribbonPoints(Array.from({length:500},(_,i)=>i%2?null:rec(i)),O).faces.length<=60);}
{ // independent oracle: python-chess material balance after each ply of a capture line; mate-in-1 verified by python on a second position
 const out=JSON.parse(execFileSync(PY,['-I','-c',`
import chess,json
V={1:1,2:3,3:3,4:5,5:9,6:0}
def mat(b): return 100*sum(V[p.piece_type]*(1 if p.color else -1) for p in b.piece_map().values())
b=chess.Board();cps=[]
for u in ['e2e4','d7d5','e4d5','d8d5','b1c3','d5a5','d2d4','c7c6']:
    b.push_uci(u);cps.append(mat(b))
s=chess.Board()
for u in ['e2e4','e7e5','f1c4','b8c6','d1h5','g8f6']: s.push_uci(u)
s.push_uci('h5f7')
print(json.dumps({'cps':cps,'mate1':s.is_checkmate(),'y':[1.6+max(-6,min(6,c/100))*0.1 for c in cps]}))`]).toString());
 ok(out.mate1,'oracle: Qxf7 mates');eq(out.cps,[0,0,100,0,0,0,0,0],'hand: exd5 wins a pawn (+100), Qxd5 wins it back');
 const hist=out.cps.map(c=>({evaluation_kind:'material_proxy',eval_cp:c,mate_in:null})).concat([mate(1)]);
 const r=ribbonPoints(hist,O);eq(r.mates,[8]);eq(r.runs,[[0,7]]);
 // samples 0..7 are one run of 7 joined segments (no strict sign change), plus 1 mate bar
 eq(r.faces.filter(f=>f.type==='segment').length,7);eq(r.faces.filter(f=>f.type==='mate').length,1);
 const P=groupFlat(r.points,3);
 r.faces.forEach((f,k)=>{if(f.type!=='segment')return;const i=f.slots[0],hz=(j)=>out.cps[i]===0&&out.cps[i+1]===0?0.02:0;near(P[k*4+3][1],out.y[i]+hz(),'left top y '+i);near(P[k*4+2][1],out.y[i+1]+hz(),'right top y '+i);
   near(P[k*4+3][0],xOf(i));near(P[k*4+2][0],xOf(i+1));});}

// 5b. regressions from adversarial review
{ // tiny negative score must hang BELOW the baseline (was drawn upward as +0.04), tiny positive up; exact 0 up hairline
 const dn=one(rec(-5)).u,up=one(rec(5)).u,zr=one(rec(0)).u;
 near(capY(dn,0),4-SKY.MIN_H,'-5cp goes down');near(capY(up,0),4+SKY.MIN_H);near(capY(zr,0),4+SKY.MIN_H);
 eq(colFace(dn,0,1).slice(0,3),[1,0.2,0.8]);
 // labels: rounding symmetric in sign (hand: +5 -> +0.1, -5 -> -0.1, -4 -> -0.0, 0 -> 0.0)
 eq([5,-5,4,-4,0,-250,249].map(c=>one(rec(c)).u.labels[0]),['+0.1','-0.1','+0.0','-0.0','0.0','-2.5','+2.5']);
 // exact-zero ribbon samples are visible (hairline), not an empty gap
 const iso=ribbonPoints([null,rec(0),null],O),run=ribbonPoints([rec(0),rec(0),rec(0)],O);
 eq(iso.faces.map(f=>f.type),['tick']);near(groupFlat(iso.points,3)[2][1]-BASE,0.02);
 eq(run.faces.length,2);ok(groupFlat(run.points,3).every((p,k)=>k%4<2||Math.abs(p[1]-BASE-0.02)<1e-9));
 eq(ribbonPoints([rec(0),rec(100)],O).faces.length,1);}
// 6. structure of the generated documents; legend honesty
for(const k of ['title','scope','height','tint','clip','mate','hollow','none','zero','ribbon','proxy'])eq(typeof LEGEND[k],'string',k);
ok(/not a probability/i.test(LEGEND.scope));ok(/search/.test(LEGEND.scope));ok(/not a zero/.test(LEGEND.none));ok(/never a number/.test(LEGEND.mate));ok(/not an engine score/i.test(LEGEND.tint));ok(/nothing is interpolated/.test(LEGEND.ribbon));ok(/not a proof|not a probability/.test(LEGEND.scope));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skyline-'));
const docs={};
for(const n of [1,5,6,20,21,64]){
 const xml=skylineXml(gridLayout({boards:n}),n);docs['sky'+n]=xml;
 eq((xml.match(/<IndexedFaceSet /g)||[]).length,1);eq((xml.match(/<IndexedLineSet /g)||[]).length,1);eq((xml.match(/<Text /g)||[]).length,n);
 eq((xml.match(/<Shape /g)||[]).length,2+n);eq((xml.match(/<Shape pointerEvents='false'/g)||[]).length,2+n,'every shape is non-pickable');
 ok(/profile='Interchange' version='4.0'/.test(xml));ok(/<component name='Rendering'/.test(xml)&&/<component name='Text'/.test(xml));ok(/<Group DEF='skyline' visible='false'>/.test(xml));
 const fi=xml.match(/<IndexedFaceSet coordIndex='([^']*)'/)[1].trim().split(/\s+/).map(Number);eq(fi.length,n*25);
 ok(fi.every((v,i)=>i%5===4?v===-1:v>=0&&v<n*8));
 const li=xml.match(/<IndexedLineSet coordIndex='([^']*)'/)[1].trim().split(/\s+/).map(Number);ok(li.every(v=>v===-1||(v>=0&&v<n*8)));
 eq(xml.match(/<ColorRGBA DEF='skyline_color' color='([^']*)'/)[1].split(',').length,n*5);eq(xml.match(/<ColorRGBA DEF='skyline_ocolor' color='([^']*)'/)[1].split(',').length,n*6);
 eq(xml.match(/<Coordinate DEF='skyline_coord' point='([^']*)'/)[1].split(',').length,n*8);
}
docs.ribbon=ribbonXml(O);ok(/pointerEvents='false'/.test(docs.ribbon));
assert.throws(()=>skylineXml(gridLayout({boards:5}),5,{def:"a'b"}),/X3D-safe/);assert.throws(()=>ribbonXml([0,0]),/origin/);checks+=2;
// 7. pinned X3D 4.0 validation (portable projection drops the X_ITE-only pointerEvents, same as terrain-test / runtime-fragments)
const files={};
for(const [k,x] of Object.entries(docs)){const p=projectPortableX3D(x,{title:'skyline test '+k});ok(!/pointerEvents/.test(p.xml));const f=path.join(dir,k+'.x3d');fs.writeFileSync(f,p.xml);files[k]=f;}
const bad=path.join(dir,'bad.x3d');fs.writeFileSync(bad,fs.readFileSync(files.sky5,'utf8').replace("colorPerVertex='false'","colorPerVertex='maybe'"));
const out=path.join(dir,'out.json');
const run=fl=>{spawnSync(PY,['tools/validate_x3d.py','--output',out,...fl],{cwd:ROOT,encoding:'utf8'});return JSON.parse(fs.readFileSync(out,'utf8')).files;};
const good=run(Object.values(files));
good.forEach(r=>{eq(r.xsd.status,'pass',JSON.stringify(r.xsd));eq(r.semantic.status,'pass',JSON.stringify(r.semantic));});
const br=run([bad])[0];eq(br.xsd.status,'fail','negative control: corrupted attribute must fail XSD');
console.log(JSON.stringify({status:'pass',test:'skyline',checks,validated_documents:good.length,scope:'pure layout/score/ribbon logic and XML syntax; no browser pixels, no live SAI'}));
