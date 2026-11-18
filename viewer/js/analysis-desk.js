// HTML instrumentation accompanies the X3D scene; chess facts stay in the pure report.
import { positionReport } from './position-report.js';
import { verifyResult, formatScore, RANK_COLORS, LEGEND } from './branches.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=n=>n>0?'+'+n:String(n);
const list=a=>a?.length?a.join(', '):'—';
const names={p:'Pawns',n:'Knights',b:'Bishops',r:'Rooks',q:'Queens'};
const note=s=>`<p class="desk-note">${esc(s)}</p>`;
const section=(title,body)=>`<section class="desk-section"><h3>${esc(title)}</h3>${body}</section>`;
const table=(rows,headers=['Measure','White','Black'])=>`<table class="data-table"><thead><tr>${headers.map(t=>`<th scope="col">${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((t,i)=>i?`<td>${esc(t)}</td>`:`<td>${esc(t)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const metric=(value,label)=>`<div class="metric"><strong>${esc(value)}</strong><small>${esc(label)}</small></div>`;
function positionHtml(p){
  const w=p.mobility.w,b=p.mobility.b,e=p.evaluation;
  return `<div class="metric-grid">${metric(signed(p.material.balance),'MATERIAL · WHITE − BLACK')}${metric(p.mobility[p.turn].count,'LEGAL MOVE CHOICES · TO MOVE')}${metric(p.controlSummary.w.attackedSquares+' / '+p.controlSummary.b.attackedSquares,'ATTACKED SQUARES · W / B')}${metric(p.kingRings.w.attackedSquares+' / '+p.kingRings.b.attackedSquares,'ATTACKED KING-RING SQUARES · W / B')}</div>`+
    section('Material ledger',table(p.material.imbalance.map(x=>[names[x.piece],x.white,x.black]))+note(p.notes.material))+
    section('Mobility laboratory',table([['Ordinary moves',w.ordinaryCount??'n/a',b.ordinaryCount??'n/a'],['Captures',w.captures??'n/a',b.captures??'n/a'],['Checks',w.checks??'n/a',b.checks??'n/a'],['Promotion choices',w.promotions??'n/a',b.promotions??'n/a']])+note(p.notes.mobility))+
    section('Score provenance',note(e.note)+(e.available?note(`${e.kind} · White POV · ${e.mate!==null?'mate '+e.mate:'cp '+e.scoreCp} · ${e.bound||'bound unspecified'} · source ply ${e.sourcePly??'?'}`):''))+
    `<details class="fen-details"><summary>Exact displayed FEN</summary><code>${esc(p.fen)}</code>${e.sourceFen?`<p>Score source FEN</p><code>${esc(e.sourceFen)}</code>`:''}</details>`;
}
function structureHtml(p){
  const w=p.pawns.w,b=p.pawns.b;
  return section('Pawn topology',table([['Passed',list(w.passed),list(b.passed)],['Isolated',list(w.isolated),list(b.isolated)],['Doubled files',list(w.doubledFiles),list(b.doubledFiles)],['Extra pawns on doubled files',w.excessPawns,b.excessPawns]])+note(p.notes.pawns))+
    section('File apertures',table(p.files.map(f=>[f.file,f.whitePawns,f.blackPawns]),['File','White pawns','Black pawns'])+note('Open files: '+list(p.files.filter(f=>f.kind==='open').map(f=>f.file))+'. A semi-open file has no friendly pawns, but has opposing pawns.'))+
    section('King-ring pressure',table([['King square',p.kingRings.w.square,p.kingRings.b.square],['Attacked ring squares',p.kingRings.w.attackedSquares,p.kingRings.b.attackedSquares],['Enemy attack relations',p.kingRings.w.enemyAttackRelations,p.kingRings.b.enemyAttackRelations],['Checking pieces',list(p.kingRings.w.checkers),list(p.kingRings.b.checkers)]])+note(p.notes.kingRing));
}
export function controlHtml(p,selected='e4'){
  let cells='<span></span>'+[...'abcdefgh'].map(f=>`<span>${f}</span>`).join('');
  for(let r=8;r>=1;r--){cells+=`<span>${r}</span>`;for(const f of 'abcdefgh'){
    const c=p.control.find(c=>c.square===f+r),state=c.balance>0?'positive':c.balance<0?'negative':'zero';
    cells+=`<button data-square="${c.square}" tabindex="${c.square===selected?0:-1}" data-balance="${state}" data-selected="${c.square===selected}" aria-label="${c.square}: White ${c.white}, Black ${c.black}, balance ${signed(c.balance)}">${signed(c.balance)}</button>`;
  }}
  const c=p.control.find(c=>c.square===selected)||p.control[0];
  return note('Exact counts, with no color saturation. Mint +: more White attackers. Coral −: more Black attackers. Select any square to inspect it in X3D.')+`<div class="matrix" role="group" aria-label="Square attack balance; rank eight at top">${cells}</div><div class="square-detail"><b>${c.square}</b> · White ${c.white} / Black ${c.black}<br>White sources: ${esc(list(c.whiteAttackers))}<br>Black sources: ${esc(list(c.blackAttackers))}</div>`+note(p.notes.control);
}
export function searchHtml(record,result,status=''){
  let html=note(status||'Hold a focused game and search several candidate continuations.');
  if(!result)return html+note('Searches are explicit. No branch scores are invented for replay, Study room, or disconnected engines.');
  if(result.fenSearched!==record.fen)return html+note('The displayed position has changed. This search result is no longer shown.');
  const checked=verifyResult(result);
  html+=checked.lines.map(l=>{
    const color=RANK_COLORS[l.rank-1]?.split(' ').map(x=>Math.round(+x*255)).join(',')||'200,200,200';
    return `<article class="search-line" style="--rank-color:rgb(${color})"><strong>#${l.rank} · ${esc(formatScore(l))}</strong><div class="pv">${esc(l.verification.san.slice(0,16).join(' '))}</div><small>White POV · depth ${esc(l.depth)} · ${esc(l.nodes??'?')} nodes · ${esc(l.time_ms??'?')} ms<br>${l.verification.total} legal plies verified${l.verification.total>16?' · first 16 shown above':''}</small><details><summary>Full verified line and resulting FEN</summary><p>${esc(l.verification.san.join(' '))}</p><code>${esc(l.verification.fenAfter)}</code></details></article>`;
  }).join('');
  return html+note(`${checked.lines.length} accepted / ${checked.rejected.length} rejected lines. ${LEGEND.pv}`)+note(LEGEND.history);
}
export class AnalysisDesk{
  constructor(root,{onSquare=()=>{},onTab=()=>{}}={}){
    this.root=root;this.content=root.querySelector('#deskContent');this.status=root.querySelector('#deskStatus');this.subject=root.querySelector('#deskSubject');this.tab='position';this.square='e4';this.key=null;this.onSquare=onSquare;
    for(const b of root.querySelectorAll('[data-tab]'))b.onclick=()=>{this.tab=b.dataset.tab;this.key=null;this.render();onTab(this.tab);};
    this.content.onclick=e=>{const b=e.target.closest('[data-square]');if(!b)return;this.square=b.dataset.square;this.key=null;this.render();this.onSquare(this.square);};
    this.content.onkeydown=e=>{const b=e.target.closest('[data-square]');if(!b)return;const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];if(!d)return;e.preventDefault();e.stopPropagation();const f=Math.max(0,Math.min(7,'abcdefgh'.indexOf(this.square[0])+d[0])),r=Math.max(1,Math.min(8,Number(this.square[1])+d[1]));this.square='abcdefgh'[f]+r;this.key=null;this.render();this.content.querySelector(`[data-square="${this.square}"]`)?.focus();this.onSquare(this.square);};
  }
  update(record,{result=null,status='',canSearch=false}={}){
    this.record=record;this.result=result;this.searchStatus=status;this.canSearch=canSearch;
    if(!this.root.hidden)this.render();
  }
  render(){
    for(const b of this.root.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===this.tab));
    this.root.querySelector('#searchControls').hidden=this.tab!=='search';
    this.root.querySelector('#deskSearch').disabled=!this.canSearch;
    const r=this.record;if(!r){this.content.innerHTML=note('Waiting for a valid position.');return;}
    const key=JSON.stringify([r.id,r.generation,r.fen,r.eval,r.evalFen,r.kind,r.bound,r.mate,r.ply,r.result,r.opening,r.evalPly,this.tab,this.square,this.result,this.searchStatus]);
    if(key===this.key)return;this.key=key;
    const focusSquare=this.content.contains(document.activeElement)?document.activeElement.dataset?.square:null;
    const p=positionReport(r.fen,{evaluation:r});this.subject.textContent=r.id;
    this.status.textContent=`${r.opening||'Position'} · ply ${r.ply} · ${p.turn==='w'?'White':'Black'} to move${p.position.inCheck?' · CHECK':''}${r.result?' · '+r.result:''}`;
    this.content.innerHTML=this.tab==='control'?controlHtml(p,this.square):this.tab==='pawns'?structureHtml(p):this.tab==='search'?searchHtml(r,this.result,this.searchStatus):positionHtml(p);
    if(focusSquare)this.content.querySelector(`[data-square="${this.square}"]`)?.focus();
  }
}
