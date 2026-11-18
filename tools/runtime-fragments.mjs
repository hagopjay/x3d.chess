#!/usr/bin/env node
/** Capture actual runtime XML writers and project documented runtime-only fields.
 * These fixtures test generated node syntax, not native pixels or chess truth.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pieceXml} from '../viewer/js/pieces.js';
import {moveFxXml,studyFxXml} from '../viewer/js/fx.js';
import {heatXml,graphXml} from '../viewer/js/overlays.js';
import {createPhaseSpace} from '../viewer/js/phasespace.js';
import {burst} from '../viewer/js/particles.js';
import {gridLayout,gridSceneXml} from '../viewer/js/layout.js';
import {projectPortableX3D} from '../viewer/js/export.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const wrap=body=>`<X3D profile='Immersive' version='4.0'><Scene>${body}</Scene></X3D>`;
const out=path.join(ROOT,'examples/x3d');await fs.mkdir(out,{recursive:true});
const fixtures=[];
async function save(name,raw,scope){
  const {xml,losses}=projectPortableX3D(raw,{title:'Chess runtime writer: '+name,metadata:{scope}});
  const data=Buffer.from(xml),file=`examples/x3d/runtime-${name}.x3d`;
  await fs.writeFile(path.join(ROOT,file),data);
  fixtures.push({file,bytes:data.length,sha256:hash(data),raw_runtime_sha256:hash(raw),projection_losses:losses,scope});
}
const pieces=['w','b'].flatMap(c=>['p','n','b','r','q','k'].map((t,i)=>`<Transform translation='${i*1.2} 0 ${c==='w'?0:2.5}'>${pieceXml(t,c)}</Transform>`)).join('');
await save('pieces',wrap('<Group>'+pieces+'</Group>'),'All twelve current piece factories; synthetic geometry bank, not a chess position.');
await save('move-fx',wrap(moveFxXml('e2e4',[{piece_square:'e5',target_squares:['f7','g6'],severity:'candidate'}],[0,0,0],{captured:true,checkSq:'e8'})),
  'Move/check/candidate relation writer syntax; this composite is a geometry fixture, not a claim that its motif is legal.');
await save('study-fx',wrap(studyFxXml({squares:[{square:'e7',color:'0.95 0.65 0.25'},{square:'f5',color:'1 0.3 0.3'}],lines:[{from:'e1',to:'e8',color:'0.95 0.65 0.25'},{from:'e7',to:'f5',color:'1 0.3 0.3'}]},[0,0,0])),
  'Actual relation overlay writer; links describe relationships, not move trajectories.');
await save('heatmap',heatXml([0,0,0]),'Actual 64-face attack-count overlay factory; color data is updated separately at runtime.');
await save('graph',graphXml([0,0,0]),'Actual evaluation graph factory before runtime history points exist.');
let capture;
const mock={currentScene:{addRootNode(){},removeRootNode(){}},async createX3DFromString(xml){capture=xml;return{rootNodes:[{}],getNamedNode(){return{};}};}};
await createPhaseSpace(mock,[12,3.5,0],3);
await save('phase-space',capture,'Captured actual feature-space factory; heuristic axes are not a physical state space or probability.');
const cleanup=await burst(mock,[0,0,0]);
if(!capture.includes('ParticleSystem'))throw new Error('Particle factory was not captured');
await save('particles',capture,'Captured actual capture-cue ParticleSystem; authored effect, not a physical simulation.');cleanup?.();
const template=await fs.readFile(path.join(ROOT,'viewer/scenes/grid.x3d'),'utf8');
for(const boards of [1,20,64])await save('grid-'+String(boards).padStart(2,'0'),gridSceneXml(template,gridLayout({boards})),
  'Actual runtime grid builder for '+boards+' boards; no live browser/SAI execution claimed.');
const sourceFiles=['viewer/js/pieces.js','viewer/js/fx.js','viewer/js/overlays.js','viewer/js/phasespace.js','viewer/js/particles.js','viewer/js/layout.js','viewer/js/export.js'];
const source_sha256={};for(const f of sourceFiles)source_sha256[f]=hash(await fs.readFile(path.join(ROOT,f)));
const report={schema:'x3dchess.runtime-fragments/1',status:'generated',created_utc:new Date().toISOString(),
  tool_sha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),source_sha256,fixtures,
  scope:'Actual XML writer capture and explicit portability projection. Run tools/validate_x3d.py for schema/implemented semantic verdicts. No browser pixels or chess analysis is inferred.'};
await fs.mkdir(path.join(ROOT,'evidence'),{recursive:true});await fs.writeFile(path.join(ROOT,'evidence/runtime-fragments.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'generated',fixtures:fixtures.length}));
