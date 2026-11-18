import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectPortableX3D,exportPositionX3D} from '../viewer/js/export.js';
const source='<X3D version="4.0" profile="Interchange"><head></head><Scene><Shape pointerEvents="false"><Box/></Shape></Scene></X3D>';
const note='Windows C:\\research\\new\nline & "quote"';
const p=projectPortableX3D(source,{title:'A & B',metadata:{note}});
assert(!p.xml.includes('pointerEvents'));assert.equal(p.losses[0].records,1);
assert(p.xml.includes('\\n'));assert(p.xml.includes('&amp;'));assert(p.xml.includes('&quot;'));
const data=JSON.parse(fs.readFileSync(new URL('../viewer/data/studies.json',import.meta.url)));
fs.mkdirSync(new URL('../examples/x3d/',import.meta.url),{recursive:true});
let count=0;
for(const study of data.studies)for(const variant of study.variants){
 const out=exportPositionX3D({fen:variant.fen,title:study.title,highlights:variant.highlights,metadata:{study:study.id,variant:variant.id}});
 assert(!out.xml.includes('pointerEvents'));assert(out.xml.includes('x3dchess.snapshot'));
 const nodes=[...out.xml.matchAll(/DEF="piece_([a-h][1-8])"/g)].map(x=>x[1]);
 assert.equal(new Set(nodes).size,out.metadata.piece_count);
 fs.writeFileSync(new URL(`../examples/x3d/${study.id}-${variant.id}.x3d`,import.meta.url),out.xml);count++;
}
console.log(JSON.stringify({status:'pass',exports:count,scope:'Owned model export, exact occupancy, explicit X_ITE picking projection and literal metadata escapes'}));
