// Scene controller: owns the BoardViews, the animation loop, and the event -> view dispatch.
import { BoardView, sqPos, fenPlacement } from "./board.js";
import { createPhaseSpace } from "./phasespace.js";

/** capture / check cues from an event: king square of the side to move when the move gave check. */
function moveExtra(ev) {
  const extra = { captured: !!ev.captured };
  if (/[+#]$/.test(ev.san || "")) {
    const king = fenPlacement(ev.fen);
    const want = ev.fen.split(" ")[1] === "w" ? "K" : "k";
    extra.checkSq = Object.keys(king).find((sq) => king[sq] === want);
  }
  return extra;
}

export async function createScene(browser, { boards = 20, cols = 5, pitch = 10 } = {}) {
  const rows = Math.ceil(boards / cols);
  const anims = [];
  const removals = [];
  const ctx = {
    browser, removals,
    animate(node, to, ms = 380) {
      const i = anims.findIndex((x) => x.node === node);
      if (i >= 0) anims.splice(i, 1);                 // a newer move supersedes a running tween (start from current pose)
      const p = node.translation;
      anims.push({ node, from: [p.x, p.y, p.z], to, t0: performance.now(), ms });
    },
  };
  const views = [];
  for (let i = 0; i < boards; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    views.push(new BoardView(ctx, i, [(c - (cols - 1) / 2) * pitch, 0, (r - (rows - 1) / 2) * pitch]));
  }
  const byId = new Map(views.map((v, i) => [`g${i}`, v]));

  const loop = (now) => {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i], k = Math.min(1, (now - a.t0) / a.ms), e = k * k * (3 - 2 * k);
      a.node.translation = new X3D.SFVec3f(
        a.from[0] + (a.to[0] - a.from[0]) * e,
        a.from[1] + (a.to[1] - a.from[1]) * e + Math.sin(Math.PI * k) * 0.7,
        a.from[2] + (a.to[2] - a.from[2]) * e);
      if (k >= 1) anims.splice(i, 1);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const stats = { moves: 0, complete: 0, tactics: 0, critical: 0, phase: 0 };
  const ps = await createPhaseSpace(browser, [cols * pitch / 2 + 7, 3.5, 0], boards);
  return {
    views, stats, phase: ps,
    /** debug/test: count pieces whose node translation differs from their square (animations settled). */
    misplaced() {
      let bad = 0;
      for (const v of views) for (const [sq, e] of v.nodes) {
        const t = sqPos(sq, v.origin), p = e.node.translation;
        if (Math.abs(p.x - t[0]) + Math.abs(p.y - t[1]) + Math.abs(p.z - t[2]) > 1e-3) bad++;
      }
      return bad;
    },
    settled: () => Promise.all(views.map((v) => v.busy)),
    childCount: () => views.reduce((n, v) => n + v.childCount(), 0),
    pieceCount: () => views.reduce((n, v) => n + v.nodes.size, 0),
    async onEvent(ev) {
      const v = byId.get(ev.game_id);
      if (!v) return;
      if (ev.type === "snapshot_game" || ev.type === "move") {
        if (ev.type === "move") { stats.moves++; if (ev.tactics?.length) stats.tactics++; if (ev.critical) stats.critical++; v.showMove(ev.uci, ev.tactics, moveExtra(ev)); }
        v.setEval(ev.eval_cp ?? 0);
        await v.apply(ev.fen);
      } else if (ev.type === "game_complete") { stats.complete++; ps.reset(ev.game_id); }
      else if (ev.type === "phase_space_update") { stats.phase++; ps.update(ev); }
    },
  };
}
