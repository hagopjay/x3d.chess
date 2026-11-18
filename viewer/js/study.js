// Deterministic rule experiments. Saved Python witnesses are independently checked
// against chess.js; this module performs no engine search or move-quality scoring.
import { Chess } from '../vendor/chess.js';

const sorted = values => [...values].sort();
const uci = m => m.from + m.to + (m.promotion || '');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const moveInput = text => {
  need(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text), 'Invalid study move');
  return {from:text.slice(0,2),to:text.slice(2,4),...(text[4]?{promotion:text[4]}:{})};
};

export function positionWitness(chess) {
  return {fen:chess.fen(),legal_moves:sorted(chess.moves({verbose:true}).map(uci)),
    check:chess.isCheck(),stalemate:chess.isStalemate(),insufficient:chess.isInsufficientMaterial(),checkmate:chess.isCheckmate()};
}

function checkWitness(chess, expected, label) {
  const actual=positionWitness(chess);
  for(const key of Object.keys(actual)) need(same(actual[key],expected[key]),`Study witness disagrees: ${label} / ${key}`);
}

function pinned(chess,square,color) {
  const p=chess.get(square);if(!p||p.color!==color||p.type==='k')return false;
  const king=chess.board().flat().find(p=>p?.type==='k'&&p.color===color);
  need(king,'Study king is missing');
  const opposite=color==='w'?'b':'w', copy=new Chess(chess.fen());
  if(copy.isAttacked(king.square,opposite))return false;
  copy.remove(square);
  return copy.isAttacked(king.square,opposite);
}

export function verifyStudyCatalog(catalog) {
  need(catalog?.schema==='x3dchess.studies/1'&&Array.isArray(catalog.studies)&&catalog.studies.length===4,'Unknown study catalog');
  const ids=new Set();let positions=0,probes=0;
  for(const lesson of catalog.studies){
    need(/^[a-z0-9-]+$/.test(lesson.id)&&!ids.has(lesson.id),'Duplicate/invalid study identity');ids.add(lesson.id);
    for(const variant of lesson.variants){
      const chess=new Chess(variant.fen);checkWitness(chess,variant.witness,lesson.id+'/'+variant.id);positions++;
      for(const q of variant.attack_queries||[])need(same(sorted(chess.attackers(q.square,q.color)),q.expected_attackers),'Attack witness differs');
      for(const q of variant.pin_queries||[])need(pinned(chess,q.square,q.color)===q.expected_pinned,'Pin witness differs');
      for(const probe of variant.probes){
        const copy=new Chess(variant.fen);let move=null;
        try{move=copy.move(moveInput(probe.uci));}catch(_){}
        need(Boolean(move)===probe.legal,'Legal-move witness differs: '+probe.uci);
        if(move)checkWitness(copy,probe.after,lesson.id+'/'+variant.id+'/'+probe.uci);
        probes++;
      }
    }
  }
  return {studies:ids.size,positions,probes};
}

export async function loadStudies(fetcher=fetch) {
  const manifestResponse=await fetcher('data/studies.manifest.json',{cache:'no-store'});
  need(manifestResponse.ok,'Study manifest could not be loaded');
  const manifest=await manifestResponse.json();
  need(manifest.schema==='x3dchess.study-manifest/1'&&manifest.file==='studies.json'&&/^[0-9a-f]{64}$/.test(manifest.sha256),'Invalid study manifest');
  const response=await fetcher('data/studies.json',{cache:'no-store'});need(response.ok,'Study data could not be loaded');
  const raw=await response.arrayBuffer();
  need(globalThis.crypto?.subtle,'Open the supplied localhost server or an HTTPS site to verify study bytes');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  need(raw.byteLength===manifest.bytes&&hash===manifest.sha256,'Study bytes differ from the manifest');
  const data=JSON.parse(new TextDecoder().decode(raw));
  need(data.producer_sha256===manifest.producer_sha256,'Study producer identity differs');
  const checks=verifyStudyCatalog(data);return {data,manifest,checks};
}

export function describePosition(chess) {
  if(chess.isCheckmate())return 'Checkmate';
  if(chess.isStalemate())return 'Stalemate · draw';
  if(chess.isInsufficientMaterial())return 'Insufficient material · draw';
  if(chess.isThreefoldRepetition())return 'Threefold repetition · study draw policy';
  if(chess.isDraw())return 'Draw detected by the rules library';
  return `${chess.turn()==='w'?'White':'Black'} to move${chess.isCheck()?' · check':''}`;
}

export class StudySession {
  constructor({scene,onChange=()=>{},onStatus=()=>{}}){
    this.scene=scene;this.onChange=onChange;this.onStatus=onStatus;this.generation=0;this.revision=0;this.active=false;
  }
  async start({lesson}={}){
    this.active=true;this.onStatus({type:'transport_status',transport:'study',state:'starting',message:'Verifying saved positions and independent rule witnesses…'});
    const loaded=await loadStudies();if(!this.active)return;
    Object.assign(this,loaded);this.lesson=loaded.data.studies.find(s=>s.id===lesson)||loaded.data.studies[0];
    this.variantIndex=0;await this.reset();
    this.onStatus({type:'transport_status',transport:'study',state:'running',message:'Rules study · no engine evaluation'});
    this.scene.select(0);
  }
  async choose(id){const lesson=this.data.studies.find(s=>s.id===id);need(lesson,'Unknown study');this.lesson=lesson;this.variantIndex=0;await this.reset();}
  async variant(index){need(Number.isInteger(index)&&index>=0&&index<this.lesson.variants.length,'Unknown comparison');this.variantIndex=index;await this.reset();}
  async reset(){this.currentVariant=this.lesson.variants[this.variantIndex];this.rawInputFen=this.currentVariant.fen;this.chess=new Chess(this.rawInputFen);this.feedback='Make a prediction, then test a move.';this.lastAttempt=null;await this.render();}
  async attempt(text){
    if(!this.active)return;
    const spec=this.lesson.probes.find(p=>p.uci===text);need(spec,'Move is not in this experiment');
    if(this.chess.history().length){this.feedback='Reset or undo to compare another move from the same starting position.';this.onChange(this.view());return;}
    let move=null;try{move=this.chess.move(moveInput(text));}catch(_){}
    this.lastAttempt={uci:text,legal:Boolean(move)};
    this.feedback=move?`${move.san} is legal. ${describePosition(this.chess)}. ${this.chess.isGameOver()?'The study has ended.':`${this.chess.moves().length} legal replies.`}`:(spec.illegal||'That move would leave the king in check and is illegal.');
    await this.render();
  }
  async undo(){if(this.chess.undo()){this.lastAttempt=null;this.feedback='Returned to the same starting position. Compare another choice.';await this.render();}}
  view(){return {lesson:this.lesson,variant:this.currentVariant,variantIndex:this.variantIndex,fen:this.chess.fen(),rawInputFen:this.rawInputFen,
    outcome:describePosition(this.chess),moves:this.chess.isGameOver()?[]:this.chess.moves({verbose:true}),ply:this.chess.history().length,
    feedback:this.feedback,lastAttempt:this.lastAttempt,manifest:this.manifest,checks:this.checks};}
  async render(){
    const revision=++this.revision,generation=++this.generation,fen=this.chess.fen(),outcome=describePosition(this.chess);
    const accepted=await this.scene.onEvent({type:'snapshot_game',game_id:'g0',generation,seq:1,fen,source_fen:this.rawInputFen,
      opening:this.lesson.title,ply:this.chess.history().length,eval_cp:null,eval_fen:null,eval_ply:null,
      evaluation_kind:'unavailable',state:this.chess.isGameOver()?'complete':'playing',result:this.chess.isDraw()?'1/2-1/2':null,reason:outcome});
    if(!this.active||revision!==this.revision)return;
    need(accepted!==false,'Study scene refused the current position');
    const base=this.chess.history().length===0?this.currentVariant.highlights:{squares:[],lines:[]};
    const highlights={squares:[...(base.squares||[])],lines:[...(base.lines||[])]};
    if(this.lastAttempt){const c=this.lastAttempt.legal?'0.3 0.9 0.7':'1 0.3 0.25';highlights.squares.push({square:this.lastAttempt.uci.slice(0,2),color:c},{square:this.lastAttempt.uci.slice(2,4),color:c});}
    await this.scene.setStudyHighlights(highlights,0);
    if(this.active&&revision===this.revision)this.onChange(this.view());
  }
  async stop(){this.active=false;this.revision++;await this.scene.clearStudyHighlights?.(0);this.onStatus({type:'transport_status',transport:'study',state:'stopped',message:'Study stopped'});}
}
