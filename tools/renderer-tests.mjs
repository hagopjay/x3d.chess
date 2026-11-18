// Actual renderer modules with a small SAI adapter. No browser-pixel claim.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { BoardView, fenPlacement, sqPos } from "../viewer/js/board.js";
import { gridLayout, gridSceneXml } from "../viewer/js/layout.js";
import { RenderEventGate } from "../viewer/js/renderer-state.js";
import { studyFxXml } from "../viewer/js/fx.js";
import { createScene } from "../viewer/js/scene.js";
import { setPieceTheme } from "../viewer/js/pieces.js";
import { THEMES } from "../viewer/js/themes.js";

class Vec { constructor(x=0,y=0,z=0,w=0) { Object.assign(this,{x,y,z,w,angle:w}); } }
class Multi extends Array { constructor(...v) { super(); this.push(...v); } }
globalThis.X3D = { SFVec3f:Vec, SFRotation:Vec, SFColor:Vec, SFColorRGBA:Vec, MFNode:Multi, MFVec3f:Multi, MFInt32:Multi, MFColor:Multi, MFColorRGBA:Multi };
let raf=0; globalThis.requestAnimationFrame=()=>++raf; globalThis.cancelAnimationFrame=()=>{};
const template = await fs.readFile(new URL("../viewer/scenes/grid.x3d",import.meta.url),"utf8");
globalThis.fetch=async()=>({ok:true,text:async()=>template});

function parse(xml) {
  const defs=new Map(),stack=[],roots=[];
  const attr=(s,n)=>new RegExp(`\\b${n}=['"]([^'"]*)['"]`).exec(s)?.[1];
  for(const m of xml.matchAll(/<(\/)?([A-Za-z]\w*)\b([^>]*?)(\/?)>/g)) {
    if(m[1]) { stack.pop(); continue; }
    const n={type:m[2],children:new Multi(),translation:new Vec(),position:new Vec(),orientation:new Vec(),callbacks:new Map(),
      getField(){return {addFieldCallback:(k,f)=>this.callbacks.set(k,f),removeFieldCallback:k=>this.callbacks.delete(k)};}};
    for(const field of ["translation","position","orientation"]) { const v=attr(m[3],field); if(v)n[field]=new Vec(...v.split(/\s+/).map(Number)); }
    if(attr(m[3],"DEF"))defs.set(attr(m[3],"DEF"),n);
    const parent=stack.at(-1);
    if(parent) {
      parent.children.push(n);
      if(m[2]==="IndexedFaceSet")parent.geometry=n;
      if(m[2]==="ColorRGBA"||m[2]==="Color")parent.color=n;
      if(m[2]==="fieldValue"&&attr(m[3],"name")==="translation")parent.translation=new Vec(...attr(m[3],"value").split(/\s+/).map(Number));
    } else roots.push(n);
    if(!m[4])stack.push(n);
  }
  const sceneNode=roots[0]?.children.find(n=>n.type==="Scene");
  const rootNodes=new Multi(...(sceneNode?.children||[]).filter(n=>n.type!=="ProtoDeclare"));
  return {rootNodes,getNamedNode(name){if(!defs.has(name))throw Error("No named node "+name);return defs.get(name);},
    addRootNode(n){rootNodes.push(n);},removeRootNode(n){const i=rootNodes.indexOf(n);if(i>=0)rootNodes.splice(i,1);},toXMLString:()=>xml};
}
class Browser {
  constructor(){this.currentScene=parse(gridSceneXml(template,gridLayout({boards:1})));this.calls=[];}
  hold(predicate){let release;this.held={predicate,promise:new Promise(r=>release=r)};return ()=>release();}
  async createX3DFromString(xml){this.calls.push(xml);if(this.fail?.(xml)){this.fail=null;throw Error("planted parse failure");}const held=this.held;if(held?.predicate(xml)){this.held=null;await held.promise;}return parse(xml);}
  async replaceWorld(s){this.currentScene=s;}
}
function view(){const browser=new Browser();return {browser,v:new BoardView({browser,cancel(){},animate(n,to){n.translation=new Vec(...to);}},0,[0,0,0])};}
const WHITE="4k3/8/8/8/8/8/8/4K3 w - - 0 1",BLACK="k7/8/8/8/8/8/8/8 b - - 0 1";
let tests=0;async function check(name,f){await f();tests++;console.log("PASS",name);}

await check("unavailable score hides the bar and clears its previous tint",()=>{
  const {v}=view();assert.deepEqual([v.proto.evalScale.x,v.proto.evalScale.y,v.proto.evalScale.z],[0,0,0]);
  v.setEval(250);assert(v.proto.evalScale.z>0);v.setEval(null);
  assert.deepEqual([v.proto.evalScale.x,v.proto.evalScale.y,v.proto.evalScale.z],[0,0,0]);assert.deepEqual([v.proto.tintDark.x,v.proto.tintDark.y,v.proto.tintDark.z],[0,0,0]);
});

await check("requested grid and piece origins agree at 1,2,20,21,64 boards",()=>{
  for(const boards of [1,2,20,21,64]){const l=gridLayout({boards}),s=parse(gridSceneXml(template,l));for(let i=0;i<boards;i++){const t=s.getNamedNode(`board_${i}`).translation;assert.deepEqual([t.x,t.y,t.z],l.origins[i]);assert.equal(sqPos('a1',l.origins[i])[0],l.origins[i][0]-3.5);}assert.throws(()=>s.getNamedNode(`board_${boards}`));}
  assert.deepEqual(gridLayout({boards:1}).origins,[[0,0,0]]);for(const n of [0,65,1.5,NaN])assert.throws(()=>gridLayout({boards:n}));
});
await check("malformed placement and overlay input refused",()=>{
  for(const f of ['8/8','9/8/8/8/8/8/8/8','x7/8/8/8/8/8/8/8','7/8/8/8/8/8/8/8'])assert.throws(()=>fenPlacement(f));
  assert.throws(()=>studyFxXml({squares:['z9']},[0,0,0]));assert.throws(()=>studyFxXml({lines:[{from:'a1',to:'a8',color:"1'/>"}]},[0,0,0]));
});
await check("piece queue recovers after rejected asynchronous creation",async()=>{
  const {browser,v}=view();browser.fail=xml=>xml.includes('<Cone');await assert.rejects(v.apply(WHITE),/planted/);await v.apply(WHITE);assert.equal(v.nodes.size,2);assert.equal(v.childCount(),2);
});
await check("new snapshot cancels old in-flight geometry",async()=>{
  const {browser,v}=view();const release=browser.hold(xml=>xml.includes('<Cone'));const a=v.apply(WHITE);await Promise.resolve();const b=v.reset(BLACK);release();await Promise.all([a,b]);assert.deepEqual([...v.nodes.keys()],['a8']);assert.equal(v.childCount(),1);
});
await check("graph creation is shared by concurrent pushes; reset clears actual lines",async()=>{
  const {browser,v}=view();const release=browser.hold(xml=>xml.includes("DEF='graph'"));const a=v.pushEval(100),b=v.pushEval(-200);release();await Promise.all([a,b]);assert.equal(browser.calls.filter(x=>x.includes("DEF='graph'")).length,1);assert.equal(v.graphScene.getNamedNode('graphc').point.length,2);v.resetEvals();assert.equal(v.graphScene.getNamedNode('graphc').point.length,0);assert.deepEqual([...v.graphScene.getNamedNode('graphline').coordIndex],[-1]);
});
await check("rapid heat on/on/off makes one shape and preserves final off intent",async()=>{
  const {browser,v}=view();const release=browser.hold(xml=>xml.includes("DEF='heat'"));const a=v.setHeat(true),b=v.setHeat(true),c=v.setHeat(false);release();await Promise.all([a,b,c]);assert.equal(browser.calls.filter(x=>x.includes("DEF='heat'")).length,1);assert.equal(v.heat.visible,false);
});
await check("latest study overlays win; snapshots clear actual cues",async()=>{
  const {browser,v}=view();const release=browser.hold(xml=>xml.includes("translation='-3.5 0.08"));const a=v.setStudyHighlights({squares:['a1']});const b=v.setStudyHighlights({squares:['b1']});await b;release();assert.equal(await a,false);assert.equal(v.studyFx.children[0].translation.x,-2.5);await v.reset(WHITE);assert.equal(v.studyFx.children.length,0);
});
await check("a fresh snapshot clears rejected cue queues for later export",async()=>{
  const {browser,v}=view();browser.fail=xml=>xml.includes("0.08");await assert.rejects(v.showMove('e2e4',[],{}));await assert.rejects(v.setStudyHighlights({squares:['z9']}));await v.reset(WHITE);await v.settled();assert.equal(v.nodes.size,2);
});
await check("event generations, sequences and terminal state prevent stale board writes",()=>{
  const g=new RenderEventGate(1),base={game_id:'g0',generation:1};assert.equal(g.accept({...base,type:'move',ply:1,seq:1}),null);assert(g.accept({...base,type:'snapshot_game',ply:0,seq:10}));assert(g.accept({...base,type:'move',ply:1,seq:11}));assert.equal(g.accept({...base,type:'move',ply:1,seq:12}),null);assert.equal(g.accept({...base,type:'move',ply:2,seq:9}),null);assert(g.accept({...base,type:'game_complete',seq:13}));assert.equal(g.accept({...base,type:'move',ply:2,seq:14}),null);assert.equal(g.accept({...base,generation:2,type:'move',ply:1,seq:15}),null);assert(g.accept({...base,generation:2,type:'snapshot_game',ply:0,seq:15}));assert.equal(g.accept({...base,type:'move',ply:99,seq:20}),null);assert.equal(g.accept({...base,game_id:'g1',type:'snapshot_game',ply:0}),null);
});
await check("a board's palette survives another scene changing the default",async()=>{
  const {browser,v}=view();await v.applyTheme(THEMES.moss);setPieceTheme(THEMES.ice);await v.apply(WHITE);
  const built=browser.calls.find(xml=>xml.includes('<Cone'));assert(built.includes(`diffuseColor='${THEMES.moss.w.c}'`));assert(built.includes(`diffuseColor='${THEMES.moss.b.c}'`));
});
await check("runtime scene constructs requested PROTOs and disposes callbacks",async()=>{
  for(const boards of [1,21]){const browser=new Browser(),scene=await createScene(browser,{boards,reducedMotion:true});await scene.setTheme('moss');assert.equal(await scene.onEvent({type:'snapshot_game',game_id:`g${boards-1}`,generation:99,seq:999,ply:0,fen:'8/8/8/8/8/8/8/8 w - - 0 1'}),false);await scene.onEvent({type:'snapshot_game',game_id:`g${boards-1}`,generation:1,ply:0,fen:WHITE});assert.equal(scene.pieceCount(),2);assert.equal(scene.misplaced(),0);assert.equal(scene.views.length,boards);const cb=scene.views[0].proto.callbacks;assert.equal(cb.size,1);scene.dispose();assert.equal(cb.size,0);assert.equal(await scene.onEvent({type:'move',game_id:'g0',generation:1,ply:1,fen:WHITE}),false);}
});
console.log(JSON.stringify({status:'pass',tests,scope:'Actual renderer helpers and asynchronous SAI-adapter controls; not native X_ITE pixels or frame-rate evidence.'}));
