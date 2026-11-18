import assert from 'node:assert/strict';
import {GameRecords,formatEvaluation} from '../viewer/js/panel.js';
import {readConfig} from '../viewer/js/config.js';
import fs from 'node:fs';
const records=new GameRecords(),fen='4k3/8/8/8/8/8/8/4K3 w - - 0 1';
records.onEvent({type:'snapshot_game',game_id:'g0',fen,ply:0,eval_cp:null,evaluation_kind:'unavailable',state:'complete',result:'1/2-1/2',reason:'insufficient material',adjudicated:true});
assert.equal(formatEvaluation(records.get('g0')),'—');assert.equal(records.get('g0').state,'complete');assert(records.get('g0').result);assert.equal(records.get('g0').adjudicated,true);assert.equal(formatEvaluation({mate:0}),'M0');
records.onEvent({type:'move',game_id:'g0',fen,ply:1,san:'Ke2',eval_cp:30,eval_fen:'pre-move',eval_ply:0,tactics:[{description:'candidate'}],critical:'small_swing',critical_for_ply:0});
assert.equal(records.get('g0').critical[0].ply,0);assert.equal(records.get('g0').evalFen,'pre-move');
records.onEvent({type:'move',game_id:'g0',fen,ply:2,san:'Ke7',eval_cp:null,tactics:[]});assert.deepEqual(records.get('g0').tactics,[]);assert.equal(formatEvaluation(records.get('g0')),'—');
assert.equal(formatEvaluation({mate:-1}),'−M1');assert.equal(readConfig('?engine=study&boards=64').boards,1);
for(const query of ['?boards=0','?boards=1.5','?boards=65','?depth=NaN','?engine=unknown','?server=javascript:alert(1)','?pool=0'])assert.throws(()=>readConfig(query));
console.log('PASS panel provenance/null evaluation/cleared findings/terminal snapshot and bounded query controls');
const html=fs.readFileSync(new URL('../viewer/index.html',import.meta.url),'utf8'),main=fs.readFileSync(new URL('../viewer/js/main.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const [,id] of main.matchAll(/\$\('([^']+)'\)/g))assert(ids.includes(id),'Missing UI target '+id);
assert(!/<x3d-canvas[^>]*\bsrc=/.test(html),'Automatic src must not overwrite the dynamic world');
for(const [,asset]of html.matchAll(/(?:src|href)="([^"#?:]+)"/g)){if(asset==='./')continue;assert(fs.existsSync(new URL('../viewer/'+asset,import.meta.url)),'Missing local asset '+asset);}
console.log('PASS static UI target/assets contract (not browser execution)');
