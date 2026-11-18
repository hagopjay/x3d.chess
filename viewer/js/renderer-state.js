// Transport revisions are acceptance boundaries, not just animation labels.
export class RenderEventGate {
  constructor(boardCount) { this.boardCount = boardCount; this.games = new Map(); }
  accept(ev) {
    const m = typeof ev?.game_id === "string" && /^g(\d+)$/.exec(ev.game_id);
    if (!m || Number(m[1]) >= this.boardCount) return null;
    if (!["snapshot_game", "snapshot", "move", "game_complete", "phase_space_update"].includes(ev.type)) return null;
    const snapshot = ev.type === "snapshot_game" || ev.type === "snapshot";
    if (!this.games.has(ev.game_id) && !snapshot) return null;
    const old = this.games.get(ev.game_id) || { generation: -1, seq: -1, ply: -1, complete: false };
    const s = { ...old };
    if (ev.generation != null) {
      if (!Number.isInteger(ev.generation) || ev.generation < 0 || ev.generation < s.generation) return null;
      if (ev.generation > s.generation) {
        if (!snapshot) return null;
        Object.assign(s, { generation: ev.generation, seq: -1, ply: -1, complete: false });
      }
    }
    if (ev.seq != null) {
      if (!Number.isInteger(ev.seq) || ev.seq < 0 || ev.seq <= s.seq) return null;
      s.seq = ev.seq;
    }
    if (snapshot || ev.type === "move") {
      if (!Number.isInteger(ev.ply) || ev.ply < 0) return null;
      if (!snapshot && (s.complete || ev.ply <= s.ply)) return null;
      s.ply = ev.ply;
      if (snapshot) s.complete = ev.state === "complete";
    } else if (ev.type === "game_complete") {
      if (s.complete) return null;
      s.complete = true;
    } else if (ev.type === "phase_space_update") {
      if (s.complete || (Number.isInteger(ev.move_number) && ev.move_number < s.ply)) return null;
      if (![ev.material_balance, ev.space_control, ev.king_safety].every(Number.isFinite)) return null;
    }
    this.games.set(ev.game_id, s);
    return { snapshot, generationChanged: s.generation !== old.generation, state: s };
  }
}
