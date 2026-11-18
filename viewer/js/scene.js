// Scene controller: owns the BoardViews, the animation loop, and the event -> view dispatch.
import { BoardView, sqPos, fenPlacement } from "./board.js";
import { createPhaseSpace } from "./phasespace.js";
import { createCameraRig } from "./camera.js";
import { GameRecords, GamePanel } from "./panel.js";
import { burst } from "./particles.js";
import { THEMES, THEME_ORDER } from "./themes.js";
import { setPieceTheme } from "./pieces.js";

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

export async function createScene(browser, { boards = 20, cols = 5, pitch = 10, panelEl = null } = {}) {
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

  const records = new GameRecords();
  const panel = panelEl ? new GamePanel(panelEl, records) : null;
  const rig = createCameraRig(browser, { boardOrigin: (i) => views[i].origin });
  let selected = null, themeName = "neon", lastPanel = 0;
  const select = (i) => { selected = i; rig.board(i); panel?.show(i); };
  const deselect = () => { selected = null; rig.overview(); panel?.hide(); };
  views.forEach((v, i) => v.proto.getField("touchTime").addFieldCallback(`touch${i}`, () => select(i)));
  const setTheme = async (name) => {
    themeName = name; const t = THEMES[name]; ctx.theme = t; setPieceTheme(t);
    browser.currentScene.getNamedNode("bg").skyColor = new X3D.MFColor(new X3D.SFColor(...t.bg.split(" ").map(Number)));
    await Promise.all(views.map((v) => v.applyTheme(t)));
    views.forEach((v) => v.lastEval != null && v.setEval(v.lastEval));
  };

  const loop = (now) => {
    rig.tick(now);
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

  const stats = { moves: 0, complete: 0, tactics: 0, critical: 0, phase: 0, bursts: 0 };
  const ps = await createPhaseSpace(browser, [cols * pitch / 2 + 7, 3.5, 0], boards);
  return {
    views, stats, phase: ps, rig, records, panel,
    select, deselect, get selected() { return selected; },
    nextBoard: (d) => select(((selected ?? -1) + d + boards) % boards),
    setTheme, get theme() { return themeName; },
    cycleTheme: () => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(themeName) + 1) % THEME_ORDER.length]),
    setHeat: (on) => Promise.all(views.map((v) => v.setHeat(on))),
    graphCount: () => views.filter((v) => v.evals?.length).length,
    heatPainted: () => views.filter((v) => v.heat && v.heat.visible).length,
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
      records.onEvent(ev);
      if (panel && selected !== null && ev.game_id === `g${selected}` && performance.now() - lastPanel > 250) { lastPanel = performance.now(); panel.render(); }
      if (ev.type === "move" && ev.captured && ev.uci) { stats.bursts++; burst(browser, sqPos(ev.uci.slice(2, 4), v.origin), themeName === "ice" ? "0.2 0.4 1" : "1 0.5 0.15"); }
      if (ev.type === "snapshot_game" || ev.type === "move") {
        if (ev.type === "move") { stats.moves++; if (ev.tactics?.length) stats.tactics++; if (ev.critical) stats.critical++; v.showMove(ev.uci, ev.tactics, moveExtra(ev)); }
        v.lastEval = ev.eval_cp ?? 0; v.setEval(v.lastEval);
        if (ev.type === "move") v.pushEval(ev.eval_cp ?? 0); else v.resetEvals();
        await v.apply(ev.fen);
      } else if (ev.type === "game_complete") { stats.complete++; ps.reset(ev.game_id); }
      else if (ev.type === "phase_space_update") { stats.phase++; ps.update(ev); }
    },
  };
}
