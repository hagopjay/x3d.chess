import {createScene} from './scene.js';
import {ReplayTransport} from './replay.js';
import {WasmTransport} from './wasm-transport.js';
import {SseTransport} from './sse-transport.js';
import {StudySession} from './study.js';
import {readConfig} from './config.js';
import {coordinateLabelsXml,exportPositionX3D} from './export.js';
import {THEMES} from './themes.js';

const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let scene=null,transport=null,config=null,heatOn=false,stopped=false,studyView=null,message='Preparing the scene';
const names={wasm:'ENGINE ARENA',sse:'UCI SERVER',replay:'REPLAY · MATERIAL PROXY',study:'STUDY ROOM · RULE WITNESSES'};
function error(e){$('error').hidden=false;$('error').textContent=e?.message||String(e);$('statusDot').dataset.state='error';}
function transportStatus(ev){if(ev.type!=='transport_status')return false;message=ev.message||ev.state;$('statusDot').dataset.state=ev.state;if(ev.state==='error')error(message);return true;}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safe(task){Promise.resolve().then(task).catch(error);}
const typing=e=>e.target?.closest?.('input,select,textarea,[contenteditable=true]');

function renderStudy(v){
  studyView=v;$('studyTitle').textContent=v.lesson.title;$('studyTag').textContent=v.lesson.tag;$('studyQuestion').textContent=v.lesson.question;
  $('studyInsight').textContent=v.lesson.insight;$('studyExplanation').textContent=v.lesson.explanation;
  $('variant').replaceChildren(...v.lesson.variants.map((item,i)=>{const o=el('option',item.label);o.value=String(i);return o;}));$('variant').value=String(v.variantIndex);
  $('studyNav').replaceChildren(...transport.data.studies.map((s,i)=>{const b=el('button',String(i+1).padStart(2,'0'));b.title=s.title;b.setAttribute('aria-label',s.title);b.setAttribute('aria-current',String(s.id===v.lesson.id));b.onclick=()=>safe(()=>transport.choose(s.id));return b;}));
  $('probes').replaceChildren(...v.lesson.probes.map(p=>{const b=el('button',p.label);b.disabled=v.ply>0;b.onclick=()=>safe(()=>transport.attempt(p.uci));return b;}));
  $('feedback').textContent=v.feedback;$('legalCount').textContent=String(v.moves.length);$('positionOutcome').textContent=v.outcome;$('studyUndo').disabled=v.ply===0;
  $('witnessNote').textContent=`Saved Python controls checked independently in chess.js · ${v.checks.positions} source positions · data ${v.manifest.sha256.slice(0,12)}. Current board: ${v.ply?'after your test':'source position'}.`;
  $('ruleSource').href='https://handbook.fide.com/chapter/e012023';$('ruleSource').textContent='FIDE articles '+v.lesson.articles.join(', ')+' ↗';
  const u=new URL(location);u.searchParams.set('lesson',v.lesson.id);history.replaceState(null,'',u);
}

async function start(){
  config=readConfig(location.search);if(!THEMES[config.theme])throw new Error('Unknown theme; choose moss, sage, mint, neon, classic or ice');
  $('mode').value=config.engine;$('modeName').textContent=names[config.engine];$('workspace').classList.toggle('study',config.engine==='study');$('studyPanel').hidden=config.engine!=='study';
  $('legend').hidden=config.engine!=='study';$('runbtn').textContent=config.engine==='study'?'Reset study':'Stop session';
  await Promise.race([customElements.whenDefined('x3d-canvas'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Local X3D runtime did not initialize')),15000))]);
  const browser=X3D.getBrowser($('canvas'));if(!browser)throw new Error('The browser could not initialize X3D');
  scene=await createScene(browser,{boards:config.boards,panelEl:config.engine==='study'?null:$('panel'),onError:error});
  await scene.setTheme(config.theme);heatOn=config.heat;if(heatOn)await scene.setHeat(true);$('heatbtn').setAttribute('aria-pressed',String(heatOn));
  if(config.engine==='study'){
    const labels=await browser.createX3DFromString(`<X3D profile="Interchange" version="4.0"><head><component name="Text" level="1"/></head><Scene>${coordinateLabelsXml(scene.layout.origins[0])}</Scene></X3D>`);
    browser.currentScene.addRootNode(labels.rootNodes[0]);
    transport=new StudySession({scene,onChange:renderStudy,onStatus:transportStatus});
    $('contextNote').textContent='Test a move, compare a constraint, and distinguish attacks from legal moves.';
  }else{
    if(config.engine==='wasm'&&(typeof Worker==='undefined'||typeof WebAssembly==='undefined'))throw new Error('Browser engines need Web Workers and WebAssembly. Choose Study room or Replay explicitly.');
    const Type={wasm:WasmTransport,sse:SseTransport,replay:ReplayTransport}[config.engine];transport=new Type(ev=>{if(!transportStatus(ev))void scene.onEvent(ev);});
  }
  window.x3dchess={scene,transport,config,ready:false};await transport.start(config);window.x3dchess.ready=true;$('loading').hidden=true;
  for(const id of ['exportFen','exportX3D','exportPacket'])$(id).disabled=false;
}

$('mode').onchange=()=>{const u=new URL(location);u.searchParams.set('engine',$('mode').value);if($('mode').value==='study')u.searchParams.set('boards','1');else if(u.searchParams.get('boards')==='1')u.searchParams.set('boards','20');location.assign(u);};
$('variant').onchange=()=>safe(()=>transport.variant(Number($('variant').value)));
$('studyReset').onclick=()=>safe(()=>transport.reset());$('studyUndo').onclick=()=>safe(()=>transport.undo());$('themebtn').onclick=()=>safe(()=>scene.cycleTheme());
const heat=()=>safe(async()=>{heatOn=!heatOn;await scene.setHeat(heatOn);$('heatbtn').setAttribute('aria-pressed',String(heatOn));});$('heatbtn').onclick=heat;
document.querySelector('[data-vp=vp_overview]').onclick=()=>{scene?.deselect();$('contextNote').textContent='Click a board to inspect its position and score provenance.';};
document.querySelector('[data-vp=vp_phase]').onclick=()=>{scene?.deselect();scene?.rig.phase();$('contextNote').textContent='Heuristic feature embedding: material, attack-count space, king shelter. Axes clip at ±5 and scale by 0.7; equal points need not mean equal positions.';};
$('runbtn').onclick=()=>safe(async()=>{if(config.engine==='study')return transport.reset();if(stopped)return location.reload();await transport?.stop();stopped=true;$('runbtn').textContent='Restart session';message='Stopped. Restart begins a new session.';});
addEventListener('keydown',e=>{if(typing(e))return;if(e.key==='Escape')scene?.deselect();else if(e.key==='ArrowRight')scene?.nextBoard(1);else if(e.key==='ArrowLeft')scene?.nextBoard(-1);else if(e.key.toLowerCase()==='t')safe(()=>scene?.cycleTheme());else if(e.key.toLowerCase()==='h')heat();});

function record(){const id=`g${scene?.selected??0}`,r=scene?.records.get(id);if(!r)throw new Error('Wait for a position or select a board');return r;}
$('exportFen').onclick=()=>safe(async()=>{const r=record();if(navigator.clipboard&&isSecureContext)await navigator.clipboard.writeText(r.fen);else download(r.id+'.fen',r.fen+'\n','text/plain');message='Position FEN copied or downloaded.';});
$('exportPacket').onclick=()=>safe(()=>{const r=record();download(r.id+'-position.json',JSON.stringify({schema:'x3dchess.observation/1',mode:config.engine,record:r,study:studyView?{id:studyView.lesson.id,variant:studyView.variant.id,input_fen:studyView.rawInputFen,catalog_sha256:studyView.manifest.sha256}:null,scope:'A current observation. FEN is not complete repetition history; heuristic motifs are not proven wins.'},null,2),'application/json');});
$('exportX3D').onclick=()=>safe(async()=>{await scene.settled();const r=record(),position=exportPositionX3D({fen:r.fen,title:r.opening||'Chess position',themeName:scene.theme,metadata:{mode:config.engine,theme:scene.theme,game_id:r.id,played_ply:r.ply,eval_fen:r.evalFen,eval_ply:r.evalPly,evaluation_kind:r.kind},highlights:studyView&&studyView.ply===0?studyView.variant.highlights:undefined});download(r.id+'-position.x3d',position.xml,'model/x3d+xml');message='Static model position exported. Engine state and animation are excluded.';});
setInterval(()=>{if(!scene)return;$('status').textContent=message;$('sceneStats').textContent=`${config.boards} BOARD${config.boards===1?'':'S'} · ${scene.pieceCount()} PIECES · ${scene.stats.moves} MOVES${scene.stats.dropped?' · '+scene.stats.dropped+' STALE EVENTS REFUSED':''}`;scene.panel?.render();},600);
addEventListener('pagehide',()=>{void Promise.resolve(transport?.stop()).catch(()=>{});scene?.dispose();});
start().catch(e=>{error(e);$('loading').hidden=true;message='Initialization did not complete';$('status').textContent=message;});
