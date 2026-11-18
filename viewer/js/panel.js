// Game panel (original: GameModal.tsx): opening, skill, eval, move list, latest tactics, eval sparkline for the focused board.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export class GameRecords {
  constructor() { this.map = new Map(); }
  get(id) { return this.map.get(id); }
  onEvent(ev) {
    if (ev.type === "snapshot_game") {
      const f = ev.fen.split(" ");
      this.map.set(ev.game_id, { id: ev.game_id, opening: ev.opening || "", skill: ev.skill ?? null, startTurn: f[1], startMove: +f[5] || 1,
        sans: [], evals: [], tactics: [], critical: [], eval: ev.eval_cp ?? 0, ply: ev.ply ?? 0, result: null, depth: null });
    } else if (ev.type === "move") {
      const r = this.map.get(ev.game_id); if (!r) return;
      r.sans.push(ev.san); r.evals.push(ev.eval_cp ?? 0); r.eval = ev.eval_cp ?? 0; r.ply = ev.ply; r.depth = ev.depth ?? r.depth;
      if (ev.tactics?.length) r.tactics = ev.tactics.map((t) => t.description).slice(0, 3);
      if (ev.critical) r.critical.push({ ply: ev.ply, severity: ev.critical });
    } else if (ev.type === "game_complete") {
      const r = this.map.get(ev.game_id); if (r) r.result = `${ev.result} (${ev.reason})`;
    }
  }
}

export class GamePanel {
  constructor(el, records) { this.el = el; this.rec = records; this.current = null; }
  show(i) { this.current = `g${i}`; this.el.hidden = false; this.render(); }
  hide() { this.current = null; this.el.hidden = true; }
  render() {
    const r = this.current && this.rec.get(this.current);
    if (!r) return;
    let line = "", n = r.startMove, white = r.startTurn === "w";
    r.sans.forEach((s, i) => {
      if (white) line += `<span class="mn">${n}.</span> `; else if (i === 0) line += `<span class="mn">${n}...</span> `;
      line += `${esc(s)} `; if (!white) n++; white = !white;
    });
    const pts = r.evals.slice(-80).map((cp, i, a) => `${(i / Math.max(1, a.length - 1)) * 220},${30 - (Math.max(-600, Math.min(600, cp)) / 600) * 28}`).join(" ");
    const sevColor = { blunder: "#f55", mistake: "#fa5", inaccuracy: "#fd5", phase_transition: "#7bf", sharp_change: "#f7f" };
    this.el.innerHTML = `<h3>${esc(r.opening || "Game")} <small>${r.id}</small></h3>
      <div class="kv"><span>eval</span><b>${(r.eval / 100).toFixed(2)}</b><span>ply</span><b>${r.ply}</b><span>skill</span><b>${r.skill ?? "-"}</b><span>depth</span><b>${r.depth ?? "-"}</b></div>
      <svg viewBox="0 0 220 60" width="220" height="60"><line x1="0" y1="30" x2="220" y2="30" stroke="#345"/><polyline points="${pts}" fill="none" stroke="#6fd"/></svg>
      <div class="moves">${line}</div>
      ${r.tactics.length ? `<div class="tac">${r.tactics.map((t) => `<div>${esc(t)}</div>`).join("")}</div>` : ""}
      <div class="crit">${r.critical.slice(-6).map((c) => `<span style="color:${sevColor[c.severity] || "#ccc"}">${c.ply}:${c.severity}</span>`).join(" ")}</div>
      ${r.result ? `<div class="res">${esc(r.result)}</div>` : ""}
      <div class="hint">Esc overview &middot; arrows next board</div>`;
  }
}
