// Focused game records: preserve score provenance and avoid unproved judgments.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function formatEvaluation(r){if(finite(r.mate))return `${r.mate===0?'':r.mate>0?'+':'−'}M${Math.abs(r.mate)}`;return finite(r.eval)?(r.eval>0?'+':'')+(r.eval/100).toFixed(2):'—';}
export class GameRecords{
  constructor(){this.map=new Map();}get(id){return this.map.get(id);}
  onEvent(ev){
    if(ev.type==='snapshot_game'||ev.type==='snapshot'){
      const f=(ev.start_fen||ev.fen).split(' ');
      this.map.set(ev.game_id,{id:ev.game_id,opening:ev.opening||'',skill:ev.skill??null,startTurn:f[1],startMove:+f[5]||1,
        sans:Array.isArray(ev.history)?ev.history.slice(-512):[],evals:[],tactics:[],critical:[],fen:ev.fen,inputFen:ev.source_fen||ev.fen,
        eval:finite(ev.eval_cp)?ev.eval_cp:null,mate:finite(ev.mate_in)?ev.mate_in:null,evalFen:ev.eval_fen??null,evalPly:ev.eval_ply??null,
        kind:ev.evaluation_kind||'unavailable',bound:ev.score_bound||null,ply:ev.ply??0,result:ev.result?`${ev.result} (${ev.reason||'complete'})`:null,
        state:ev.state||'playing',adjudicated:!!ev.adjudicated,drawPolicy:ev.draw_policy??null,depth:null,generation:ev.generation,seq:ev.seq});
    }else if(ev.type==='move'){
      const r=this.get(ev.game_id);if(!r)return;
      r.sans.push(ev.san);if(r.sans.length>512)r.sans.shift();r.eval=finite(ev.eval_cp)?ev.eval_cp:null;r.mate=finite(ev.mate_in)?ev.mate_in:null;
      r.kind=ev.evaluation_kind||'unavailable';r.evalFen=ev.eval_fen??null;r.evalPly=ev.eval_ply??null;r.bound=ev.score_bound||null;
      r.evals.push(r.mate===null?r.eval:null);if(r.evals.length>120)r.evals.shift();r.fen=ev.fen;r.ply=ev.ply;r.depth=ev.depth??r.depth;r.generation=ev.generation;r.seq=ev.seq;
      r.tactics=(ev.tactics||[]).map(t=>t.description).slice(0,3);
      if(ev.critical){r.critical.push({ply:ev.critical_for_ply??ev.eval_ply??ev.ply,severity:ev.critical});if(r.critical.length>40)r.critical.shift();}
    }else if(ev.type==='game_complete'){const r=this.get(ev.game_id);if(r){r.result=`${ev.result} (${ev.reason})`;r.state='complete';r.adjudicated=!!ev.adjudicated;}}
  }
}
export class GamePanel{
  constructor(el,records){this.el=el;this.rec=records;this.current=null;}show(i){this.current=`g${i}`;this.el.hidden=false;this.render();}hide(){this.current=null;this.el.hidden=true;}
  render(){
    const r=this.current&&this.rec.get(this.current);if(!r)return;let line='',n=r.startMove,white=r.startTurn==='w';
    for(const[i,s]of r.sans.entries()){if(white)line+=`<span class="mn">${n}.</span> `;else if(i===0)line+=`<span class="mn">${n}...</span> `;line+=esc(s)+' ';if(!white)n++;white=!white;}
    const pts=r.evals.slice(-80).map((cp,i,a)=>finite(cp)?`${i/Math.max(1,a.length-1)*220},${30-Math.max(-600,Math.min(600,cp))/600*28}`:null),paths=[];let segment=[];
    for(const p of pts){if(p)segment.push(p);else if(segment.length){paths.push(segment.join(' '));segment=[];}}if(segment.length)paths.push(segment.join(' '));
    const source=r.kind==='material_proxy'?'Material proxy · no engine':r.kind==='unavailable'?'No evaluation':`White-positive search score${r.bound&&r.bound!=='exact'?' · '+r.bound+' bound':''}`;
    const binding=r.evalFen?`Score at played ply ${r.evalPly??'?'}${r.evalFen!==r.fen?' · before the displayed move':''}`:'No searched position attached';
    this.el.innerHTML=`<div class="eyebrow">FOCUSED BOARD · ${esc(r.id)}</div><h3>${esc(r.opening||'Game')}</h3><div class="eval-heading"><strong>${esc(formatEvaluation(r))}</strong><span>${esc(source)}</span></div><p class="binding">${esc(binding)}</p>
      <div class="kv"><span>Played plies</span><b>${esc(r.ply)}</b><span>Depth</span><b>${esc(r.depth??'—')}</b><span>Skill</span><b>${esc(r.skill??'—')}</b></div>
      <svg viewBox="0 0 220 60" width="220" height="60" role="img" aria-label="Available scores, clipped at plus or minus six display units"><line x1="0" y1="30" x2="220" y2="30" stroke="#345"/>${paths.map(p=>`<polyline points="${p}" fill="none" stroke="#83d9bf"/>`).join('')}</svg><div class="moves">${line||'<span class="muted">Waiting for moves.</span>'}</div>
      ${r.tactics.length?'<div class="tac"><b>Geometric candidates</b>'+r.tactics.map(t=>`<p>${esc(t)}</p>`).join('')+'</div>':''}<div class="crit">${r.critical.slice(-5).map(c=>`<span>${esc(c.ply)} · ${esc(c.severity.replaceAll('_',' '))}</span>`).join('')}</div>${r.result?`<div class="res">${esc(r.result)}${r.adjudicated?' · spectator policy':''}</div>`:''}<p class="hint">A motif is a candidate, not a proven win. Score swings are not move-quality verdicts.</p><div class="hint">Esc overview · arrows next board</div>`;
  }
}
