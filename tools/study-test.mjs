import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {Chess} from '../viewer/vendor/chess.js';
import {verifyStudyCatalog,positionWitness,StudySession} from '../viewer/js/study.js';
const raw=fs.readFileSync(new URL('../viewer/data/studies.json',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(new URL('../viewer/data/studies.manifest.json',import.meta.url)));
assert.equal(raw.length,manifest.bytes);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),manifest.sha256);
const catalog=JSON.parse(raw),checks=verifyStudyCatalog(catalog);
assert.deepEqual({studies:checks.studies,positions:checks.positions},{studies:4,positions:7});
const pin=new Chess(catalog.studies[0].variants[0].fen);
assert.deepEqual(pin.attackers('f5','b'),['e7']);
assert(!positionWitness(pin).legal_moves.includes('f4f5'));
const ep=catalog.studies[1].variants[0];assert.equal(ep.fen.split(' ')[3],'f6');assert.equal(new Chess(ep.fen).fen().split(' ')[3],'-');
const damaged=structuredClone(catalog);damaged.studies[0].variants[0].witness.legal_moves.push('f4f5');
assert.throws(()=>verifyStudyCatalog(damaged),/disagrees/);
const falseTerminal=structuredClone(catalog);falseTerminal.studies[2].variants[0].probes[0].after.stalemate=false;
assert.throws(()=>verifyStudyCatalog(falseTerminal),/disagrees/);
console.log(JSON.stringify({status:'pass',scope:'Independent chess.js versus saved python-chess controls, including wrong-legality and wrong-terminal twins',...checks}));

// Exercise real session transitions with deferred scene work. This checks the
// orchestration contract, not a browser or actual X_ITE field implementation.
const realFetch=globalThis.fetch,events=[],highlights=[],views=[];
globalThis.fetch=async url=>new Response(fs.readFileSync(new URL('../viewer/'+url,import.meta.url)),{status:200});
let deferred=null;
const scene={select(){},async onEvent(e){events.push(e);if(deferred){const wait=deferred;deferred=null;await wait.promise;}return true;},
 async setStudyHighlights(h){highlights.push(h);},async clearStudyHighlights(){highlights.length=0;}};
try{
 const session=new StudySession({scene,onChange:v=>views.push(v)});
 await session.start();assert.equal(session.view().lesson.id,'pin-paradox');
 const before=session.view().fen;await session.attempt('f4f5');assert.equal(session.view().fen,before);assert.equal(session.view().lastAttempt.legal,false);
 await session.choose('en-passant-ray');await session.variant(1);await session.attempt('g5f6');assert.equal(session.view().ply,1);assert.equal(session.view().lastAttempt.legal,true);
 await session.undo();assert.equal(session.view().ply,0);assert.equal(session.view().lastAttempt,null);
 await session.choose('underpromotion');await session.attempt('c7c8b');assert.match(session.view().outcome,/Insufficient/);assert.equal(session.view().moves.length,0);assert.match(session.view().feedback,/ended/);
 await session.reset();await session.attempt('c7c8q');assert.match(session.view().outcome,/Stalemate/);assert.equal(events.at(-1).state,'complete');
 let release;deferred={promise:new Promise(r=>{release=r;})};
 const old=session.choose('pin-paradox');await session.choose('castling-transit');const completed=views.length,highlighted=highlights.length;release();await old;
 assert.equal(views.length,completed);assert.equal(highlights.length,highlighted);assert.equal(session.view().lesson.id,'castling-transit');
 assert(events.every((e,i)=>!i||e.generation>events[i-1].generation));
 let releaseStopped;deferred={promise:new Promise(r=>{releaseStopped=r;})};const pending=session.reset();await session.stop();releaseStopped();await pending;assert.equal(highlights.length,0);
}finally{globalThis.fetch=realFetch;}
console.log('PASS study session legal/illegal/undo/dead-position/counterfactual transitions and stale reset/stop controls');
