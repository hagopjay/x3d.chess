// Known-answer tests for viewer/js/terrain.js. Oracle values come from python-chess
// (CHESS_TEST_PYTHON) plus hand derivations, never from the module under test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {terrainXml,terrainUpdate,terrainPoints,terrainColors,terrainFromGrid,terrainGrid,LEGEND,TERRAIN_MODES,groupFlat} from '../viewer/js/terrain.js';
import {projectPortableX3D} from '../viewer/js/export.js';
import {heatColors} from '../viewer/js/overlays.js';
const PY=process.env.CHESS_TEST_PYTHON||'python3';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const O=[3,0,-2];
const pyGrid=(fen,mode)=>JSON.parse(execFileSync(PY,['-I','-c',`
import chess,json,sys
b=chess.Board(sys.argv[1]);V={1:1,2:3,3:3,4:5,5:9,6:0}
g=[]
for s in range(64):
    w=b.attackers(chess.WHITE,s);k=b.attackers(chess.BLACK,s)
    if sys.argv[2]=='count': g.append(len(w)-len(k))
    else: g.append(sum(V[b.piece_type_at(a)] for a in w)-sum(V[b.piece_type_at(a)] for a in k))
print(json.dumps(g))`,fen,mode]).toString());
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIN='4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1';           // white Be2 pinned by black Re7 against Ke1
const MID='r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const sq=(n)=>'abcdefgh'.indexOf(n[0])+8*(+n[1]-1);
let checks=0;const ok=(c,m)=>{assert(c,m);checks++;};

// 1. empty-ish: kings only far apart -> hand check: both kings attack own neighbours; no square has both.
const kings='4k3/8/8/8/8/8/8/4K3 w - - 0 1';
{const g=terrainGrid(kings);assert.deepEqual(g,pyGrid(kings,'count'));
 assert.equal(g[sq('d1')],1);assert.equal(g[sq('d8')],-1);assert.equal(g[sq('a4')],0);checks+=3;}
// 2. start position: hand values and mirror antisymmetry
{const g=terrainGrid(START);assert.deepEqual(g,pyGrid(START,'count'));
 assert.equal(g[sq('a3')],2);assert.equal(g[sq('c3')],3);assert.equal(g[sq('d3')],2);assert.equal(g[sq('a6')],-2);assert.equal(g[sq('c6')],-3);checks+=6;
 for(let r=0;r<8;r++)for(let f=0;f<8;f++)assert.equal(g[r*8+f]+g[(7-r)*8+f],0);checks+=64;
 const u=terrainUpdate(START,O);
 for(let r=0;r<8;r++)for(let f=0;f<8;f++){assert.equal(u.heights[r*8+f],u.heights[(7-r)*8+f]);
   const a=u.colors.slice((r*8+f)*20,(r*8+f)*20+4),b=u.colors.slice(((7-r)*8+f)*20,((7-r)*8+f)*20+4);
   if(g[r*8+f]){assert.equal(a[0]===0.1,b[0]===1);}}
 checks+=64;}
// 3. pinned attacker still counted: Be2 pinned (can't legally move off e-file) still attacks d3,f3,c4,g4,b5,h5,d1,f1.
{const g=terrainGrid(PIN);assert.deepEqual(g,pyGrid(PIN,'count'));
 for(const s of ['d3','f3','c4','g4','b5','h5'])assert.equal(g[sq(s)],1,s);
 assert.equal(g[sq('e2')],0);assert.equal(g[sq('e3')],-1);checks+=8;
 // material mode: bishop = 3; rook = 5 on e3..e6.
 const m=terrainGrid(PIN,'material');assert.deepEqual(m,pyGrid(PIN,'material'));assert.equal(m[sq('d3')],3);assert.equal(m[sq('e3')],-5);checks+=3;
 // king attackers are worth 0 in material mode: d1 attacked by Ke1 (0) and Be2 (3) -> 3
 assert.equal(m[sq('d1')],3);checks++;}
// 4. independent python agreement on a middlegame, both modes
for(const f of [MID,START])for(const mode of ['count','material']){assert.deepEqual(terrainGrid(f,mode),pyGrid(f,mode),f+mode);checks++;}
// 5. heat legend colour agreement: sign hue matches heat overlay
{const heat=heatColors(MID),g=terrainGrid(MID),t=terrainColors(g);
 for(let s=0;s<64;s++){const top=t.slice(s*20,s*20+4);
  if(!g[s])assert.equal(top[3],0);else assert.deepEqual(top.slice(0,3),heat[s].slice(0,3));}checks+=64;}
// 6. structure: sizes, no NaN, indices in range, outward normals, heights, clipping
{const u=terrainUpdate(MID,O);
 assert.equal(u.heights.length,64);assert.equal(u.clipped.length,64);assert.equal(u.colors.length,320*4);assert.equal(u.points.length,512*3);
 for(const v of [...u.points,...u.colors,...u.heights])assert(Number.isFinite(v));checks+=5;
 for(const c of u.colors)assert(c>=0&&c<=1);checks++;
 const xml=terrainXml(O),idxs=xml.match(/coordIndex='([^']*)'/)[1].trim().split(/\s+/).map(Number);
 assert.equal(idxs.length,64*5*5);let faces=0;
 const P=groupFlat(terrainPoints(new Array(64).fill(2),O),3);
 for(let i=0;i<idxs.length;i+=5){assert.equal(idxs[i+4],-1);for(let k=0;k<4;k++)assert(idxs[i+k]>=0&&idxs[i+k]<512);
  const f=idxs.slice(i,i+4).map(j=>P[j]);const col=Math.floor(idxs[i]/8);
  const cen=P.slice(col*8,col*8+8).reduce((a,p)=>a.map((v,j)=>v+p[j]/8),[0,0,0]);
  const e1=f[1].map((v,j)=>v-f[0][j]),e2=f[2].map((v,j)=>v-f[1][j]);
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  const fc=f.reduce((a,p)=>a.map((v,j)=>v+p[j]/4),[0,0,0]);
  const dot=n.reduce((a,v,j)=>a+v*(fc[j]-cen[j]),0);assert(dot>0,'face '+faces+' inward');faces++;}
 assert.equal(faces,320);checks+=320+2;
 // column geometry sits on the right square: a1 (index 0) near x=O0-4, z=O2+3 (rank 1 at +z)
 assert(u.points[0]>=O[0]-4&&u.points[0]<=O[0]-3);assert(u.points[2]>O[2]+3&&u.points[2]<=O[2]+4);checks+=2;}
{ // clipping with synthetic grid: only >cap is clipped; cap colour distinct; sides keep sign colour
 const g=new Array(64).fill(0);g[0]=9;g[1]=6;g[2]=-7;g[3]=-1;
 const u=terrainFromGrid(g,O);
 assert.deepEqual(u.clipped.slice(0,5),[true,false,true,false,false]);
 assert(Math.abs(u.heights[0]-0.6)<1e-12);assert(Math.abs(u.heights[1]-0.6)<1e-12);assert(Math.abs(u.heights[3]-0.1)<1e-12);
 assert.deepEqual(u.colors.slice(0,4),[1,0.85,0.2,1]);assert.notDeepEqual(u.colors.slice(20,24),[1,0.85,0.2,1]);
 assert.deepEqual(u.colors.slice(4,7).map(x=>+x.toFixed(6)),[0.07,0.63,0.7]);
 assert(Math.abs(u.points[3*8*0+13]-(0.07+0.6))<1e-12);  // top vertex y of column 0
 checks+=9;
 // material cap 12
 const m=terrainFromGrid(g,O,'material');assert.deepEqual(m.clipped.slice(0,3),[false,false,false]);assert(Math.abs(m.heights[0]-0.45)<1e-12);checks+=2;
 // only y changes: x,z of points are identical for any grid
 const a=terrainPoints(new Array(64).fill(0),O),b=terrainPoints(g,O);
 for(let i=0;i<a.length;i++)if(i%3!==1)assert.equal(a[i],b[i]);checks++;
 assert(b.some((v,i)=>i%3===1&&v!==a[i]));checks++;}
// 6b. review fixes: groupFlat must reject k<1 / non-integer / ragged input (k=0 used to loop forever); material clip boundary; extra oracle FENs
assert.throws(()=>groupFlat([1,2,3],0),/positive integer/);assert.throws(()=>groupFlat([1,2,3],1.5),/positive integer/);
assert.throws(()=>groupFlat([1,2,3],2),/multiple/);assert.throws(()=>groupFlat('abc',1),/array/);assert.deepEqual(groupFlat([1,2,3,4],2),[[1,2],[3,4]]);checks+=5;
{const g=new Array(64).fill(0);g[0]=12;g[1]=13;g[2]=-13;const m=terrainFromGrid(g,O,'material');
 assert.deepEqual(m.clipped.slice(0,3),[false,true,true]);assert(Math.abs(m.heights[1]-0.6)<1e-12);
 assert.notDeepEqual(m.colors.slice(0,4),[1,0.85,0.2,1]);assert.deepEqual(m.colors.slice(20,24),[1,0.85,0.2,1]);assert.deepEqual(m.colors.slice(40,44),[1,0.85,0.2,1]);checks+=5;}
for(const f of ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1','7k/8/8/8/8/8/8/R3K2R b KQ - 0 1','4k3/P7/8/8/8/8/p7/4K3 w - - 0 1','r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4'])
 for(const mode of ['count','material']){assert.deepEqual(terrainGrid(f,mode),pyGrid(f,mode),f+mode);checks++;}
assert.match(LEGEND.color,/only by kings/);checks++;
// 7. legend honesty strings
for(const k of ['count','material','color','clip','pins','limits'])assert.equal(typeof LEGEND[k],'string');
assert.match(LEGEND.count,/not legal mobility/);assert.match(LEGEND.material,/not SEE/);assert.match(LEGEND.pins,/Pinned/);assert(TERRAIN_MODES.count&&TERRAIN_MODES.material);checks+=9;
// 8. XML validity via pinned validator + negative control
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'terrain-'));
const good=path.join(dir,'terrain.x3d'),bad=path.join(dir,'bad.x3d');
const xml=terrainXml(O,{def:'terrain3'});
assert.match(xml,/pointerEvents='false'/);assert.match(xml,/visible='false'/);assert.match(xml,/profile='Interchange' version='4.0'/);assert.match(xml,/<component name='Rendering'/);
assert.equal((xml.match(/<Shape /g)||[]).length,1);assert.equal((xml.match(/<IndexedFaceSet /g)||[]).length,1);checks+=6;
// pointerEvents is an X_ITE extension: validate the portable projection (same approach as runtime-fragments.mjs)
const proj=projectPortableX3D(xml,{title:'terrain test'});assert.equal(proj.losses[0].records,1);assert(!/pointerEvents/.test(proj.xml));checks+=2;
fs.writeFileSync(good,proj.xml);fs.writeFileSync(bad,proj.xml.replace("colorPerVertex='false'","colorPerVertex='maybe'"));
const val=(f)=>{const r=spawnSync(PY,['tools/validate_x3d.py','--output',path.join(dir,'out.json'),f],{cwd:ROOT,encoding:'utf8'});
 const row=JSON.parse(fs.readFileSync(path.join(dir,'out.json'),'utf8')).files[0];return row;};
const gr=val(good),br=val(bad);
assert.equal(gr.xsd.status,'pass',JSON.stringify(gr.xsd));assert.equal(gr.semantic.status,'pass',JSON.stringify(gr.semantic));
assert.equal(br.xsd.status,'fail');checks+=3;
// 9. negative controls on inputs
const g0=terrainGrid(START);
assert.throws(()=>terrainPoints(g0.slice(0,63),O),/exactly 64/);
assert.throws(()=>terrainPoints([...g0,0],O),/exactly 64/);
assert.throws(()=>terrainColors(g0.slice(1)),/exactly 64/);
assert.throws(()=>terrainFromGrid(Object.assign(g0.slice(),{5:NaN}),O),/integer/);
assert.throws(()=>terrainFromGrid(Object.assign(g0.slice(),{5:1.5}),O),/integer/);
assert.throws(()=>terrainFromGrid(g0,[0,NaN,0]),/origin/);
assert.throws(()=>terrainFromGrid(g0,O,'nope'),/mode/);
assert.throws(()=>terrainUpdate('not a fen'));
assert.throws(()=>terrainXml([0,0]),/origin/);
checks+=9;
// oracle negative control: a deliberately corrupted grid must disagree with python-chess
const wrong=terrainGrid(MID);wrong[27]+=1;assert.notDeepEqual(wrong,pyGrid(MID,'count'));checks++;
console.log(JSON.stringify({status:'pass',test:'terrain',checks,xsd:gr.xsd.status,semantic:gr.semantic.status,scope:'static attack-count / attacker-value terrain geometry; no browser pixels'}));
