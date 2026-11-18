import assert from 'node:assert/strict';
import {pieceXml} from '../viewer/js/pieces.js';
import {THEMES} from '../viewer/js/themes.js';
import {createCameraRig} from '../viewer/js/camera.js';

// Unlike a syntax-only check, these controls catch reversed shells, open seams,
// degenerate faces and out-of-range indices in the actual authored meshes.
let meshes=0,faces=0;
for(const type of ['p','r','n','b','q','k'])for(const color of ['w','b']){
  const xml=pieceXml(type,color,THEMES.classic);
  assert(!/NaN|Infinity|undefined/.test(xml));
  const shapes=[...xml.matchAll(/<Shape\b/g)].length;
  assert(shapes>=2&&shapes<=7);
  for(const [,attrs,pointText] of xml.matchAll(/<IndexedFaceSet\b([^>]*)><Coordinate point='([^']+)'\/><\/IndexedFaceSet>/g)){
    const values=pointText.split(/[\s,]+/).map(Number);assert.equal(values.length%3,0);
    const points=Array.from({length:values.length/3},(_,i)=>values.slice(i*3,i*3+3));
    for(const [x,y,z] of points){assert(Number.isFinite(x+y+z));assert(Math.abs(x)<=.5&&Math.abs(z)<=.5&&y>=0&&y<1.5);}
    const indices=attrs.match(/coordIndex='([^']+)'/)[1].trim().split(/\s+/).map(Number);
    const polygons=[];let current=[];
    for(const i of indices){if(i===-1){polygons.push(current);current=[];}else{assert(Number.isInteger(i)&&i>=0&&i<points.length);current.push(i);}}
    assert.equal(current.length,0);const edges=new Map();let volume=0;
    for(const poly of polygons){
      assert(poly.length>=3);assert.equal(new Set(poly).size,poly.length);faces++;
      for(let i=0;i<poly.length;i++){
        const a=poly[i],b=poly[(i+1)%poly.length],key=[Math.min(a,b),Math.max(a,b)].join(',');
        const e=edges.get(key)||{n:0,orientation:0};e.n++;e.orientation+=a<b?1:-1;edges.set(key,e);
      }
      const [a,b,c]=poly.slice(0,3).map(i=>points[i]),ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
      const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      assert(Math.hypot(...cross)>1e-8,'degenerate face');
      // Signed tetrahedral volume works for the concave knight's oriented
      // polygon too; it does not claim a general-purpose triangulator.
      for(let i=1;i<poly.length-1;i++){
        const p=points[poly[0]],q=points[poly[i]],r=points[poly[i+1]];
        volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
      }
    }
    for(const e of edges.values()){assert.equal(e.n,2,'open/nonmanifold edge');assert.equal(e.orientation,0,'inconsistent winding');}
    assert(volume>0,'inward shell');meshes++;
  }
  if(type==='n')assert.equal(xml.includes("rotation='0 1 0 3.141592653589793'"),color==='b');
}
assert.throws(()=>pieceXml('dragon','w'));assert.throws(()=>pieceXml('p','gold'));

class Vec{constructor(...v){[this.x,this.y,this.z,this.angle]=v;}}
globalThis.X3D={SFVec3f:Vec,SFRotation:Vec};
const nodes=new Map(['vp_overview','vp_phase','vp_focus'].map(n=>[n,{position:new Vec(0,18,13),orientation:new Vec(1,0,0,-1)}]));
const rig=createCameraRig({currentScene:{getNamedNode:n=>nodes.get(n)}},{boardOrigin:()=>[2,0,3],ms:100});
const end=()=>rig.tick(performance.now()+150);
rig.board(0);end();assert.deepEqual(rig.pose().p,[2,11.3,13]);
rig.boardTop(0);end();assert.deepEqual(rig.pose().p,[2,14.5,3]);
rig.boardBlack(0);rig.tick(performance.now()+50);
assert(rig.pose().o.every(Number.isFinite));assert(Math.abs(Math.hypot(...rig.pose().o.slice(0,3))-1)<1e-9);
end();assert.deepEqual(rig.pose().p,[2,11.3,-7]);assert.equal(rig.name,'board_0_black');
const [x,y,z,a]=rig.pose().o;
// Rodrigues rotation of camera forward (0,0,-1) must face down and +Z.
const forward=[-y*Math.sin(a)-x*z*(1-Math.cos(a)),x*Math.sin(a)-y*z*(1-Math.cos(a)),-Math.cos(a)-z*z*(1-Math.cos(a))];
assert(forward[1]<-.6&&forward[2]>.6);
const layout={p:rig.pose().p,o:rig.pose().o};rig.overview();end();assert.equal(rig.name,'overview');
console.log(JSON.stringify({status:'pass',meshes,faces,camera_poses:4,scope:'Closed outward-wound bounded authored meshes and finite normalized camera rotations; native shading and frame times remain independent checks.'}));
