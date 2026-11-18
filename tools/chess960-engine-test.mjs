// Chess960 through the real vendored Stockfish (Node subprocess adapter) and the real WasmTransport.
// Run: node tools/chess960-engine-test.mjs
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {WasmEnginePool} from '../viewer/js/engine-pool.js';
import {WasmTransport} from '../viewer/js/wasm-transport.js';
import {Chess960} from '../viewer/js/chess960.js';
import {Chess} from '../viewer/vendor/chess.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const engine=path.join(root,'viewer/vendor/stockfish/stockfish-19-lite-single.js');
class NodeUciWorker{
  constructor(){this.child=spawn(process.execPath,[engine],{stdio:['pipe','pipe','pipe']});this.closed=false;this.errors='';
    readline.createInterface({input:this.child.stdout}).on('line',l=>this.onmessage?.({data:l}));
    this.child.stderr.on('data',c=>{this.errors+=c;});
    this.child.on('exit',(code)=>{if(!this.closed)this.onerror?.({message:`Stockfish exited ${code}: ${this.errors.slice(-300)}`,preventDefault(){}});});}
  postMessage(c){this.child.stdin.write(c+'\n');}
  terminate(){this.closed=true;this.child.kill();}
}
const events=[],errors=[];
const t=new WasmTransport(e=>{events.push(e);if(e.type==='transport_status'&&e.state==='error')errors.push(e.message);},
  {poolFactory:(c)=>new WasmEnginePool({...c,size:2,workerFactory:()=>new NodeUciWorker(),initTimeoutMs:20000,searchTimeoutMs:30000})});
await t.start({boards:3,seed:7,depth:4,variant:'960'});
const mirror=new Map(),deadline=Date.now()+90000;let moves=0,castles=0;
const seenIds=new Set();
while(moves<45&&Date.now()<deadline&&!errors.length){
  await new Promise(r=>setTimeout(r,200));
  while(events.length){
    const e=events.shift();
    if(e.type==='snapshot_game'){assert.equal(e.variant,'chess960');seenIds.add(e.position_id);mirror.set(e.game_id,new Chess960(e.fen960));assert.equal(new Chess(e.fen).fen(),e.fen);}
    if(e.type==='move'){
      const g=mirror.get(e.game_id);assert.ok(g,'move before snapshot');
      const legal=g.legalUci();assert.ok(legal.includes(e.engine_uci||e.uci),`engine move ${e.engine_uci||e.uci} not in legal set ${legal}`);
      const mv=g.move({from:(e.engine_uci||e.uci).slice(0,2),to:(e.engine_uci||e.uci).slice(2,4),promotion:(e.engine_uci||e.uci)[4]});
      assert.equal(mv.san,e.san);assert.equal(g.fen(),e.fen);assert.equal(g.fen960(),e.fen960);
      assert.ok(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(e.uci),'display uci');
      if(e.castle){castles++;assert.equal(e.engine_uci.slice(0,2),e.uci.slice(0,2));}
      moves++;
    }
  }
}
// Engine analysis of a 960 board comes back bound to the chess.js FEN the overlays hold.
const gid=[...mirror.keys()][0],held=t.holdGame(gid);
const res=await t.analyze(held,{multipv:2,depth:4});
assert.equal(res.fenSearched,held);assert.ok(res.engineFen,'engineFen kept for PV verification');t.releaseGame(gid);
// History with a castle in UCI_Chess960 encoding: the engine must accept the Shredder-FEN and king-takes-rook move.
{const start='4k3/8/8/8/8/8/8/R3K2R w HAh - 0 1'.replace(' HAh ',' HA ');
 const r=await t.pool.search('4k3/8/8/8/8/8/8/R4RK1 b - - 1 1'.replace(' b - - 1 1',' b - - 1 1'),{depth:4,initialFen:start,moves:['e1h1'],gameKey:'castle-history',chess960:true});
 const g=new Chess960(start);g.move({from:'e1',to:'h1'});assert.ok(g.legalUci().includes(r.uci),'engine move after a castle in its history is legal: '+r.uci);}
await t.stop({silent:true});
assert.deepEqual(errors,[]);assert.ok(moves>=45,`only ${moves} moves in time`);
console.log(`ok: ${moves} real Stockfish 960 moves over ${seenIds.size} start positions replayed on the 960 mirror (${castles} castles); analysis bound to the overlay FEN`);
