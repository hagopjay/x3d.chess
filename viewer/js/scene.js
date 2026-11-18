// Scene controller: requested grid, guarded event acceptance, bounded overlays.
import { BoardView, sqPos, fenPlacement } from "./board.js";
import { createPhaseSpace } from "./phasespace.js";
import { createCameraRig } from "./camera.js";
import { GameRecords, GamePanel } from "./panel.js";
import { burst } from "./particles.js";
import { THEMES, THEME_ORDER } from "./themes.js";
import { setPieceTheme } from "./pieces.js";
import { gridLayout, gridSceneXml } from "./layout.js";
import { RenderEventGate } from "./renderer-state.js";
import { Chess } from "../vendor/chess.js";

function moveExtra(ev) {
  const extra = { captured: !!ev.captured };
  if (/[+#]$/.test(ev.san || "")) {
    const king = fenPlacement(ev.fen), want = ev.fen.split(" ")[1] === "w" ? "K" : "k";
    extra.checkSq = Object.keys(king).find((sq) => king[sq] === want);
  }
  return extra;
}

export async function createScene(browser, { boards = 20, cols = 5, pitch = 10, panelEl = null, onError = null, reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false } = {}) {
  const layout = gridLayout({ boards, cols, pitch });
  const response = await fetch(new URL("../scenes/grid.x3d", import.meta.url));
  if (!response.ok) throw new Error("The local X3D board template is unavailable");
  const gridXml = gridSceneXml(await response.text(), layout);
  const world = await browser.createX3DFromString(gridXml);
  await browser.replaceWorld(world);
  let disposed = false, raf = null, themeQueue = Promise.resolve();
  const anims = [], burstCleanups = new Set();
  const ctx = {
    browser,
    cancel(node) { for (let i = anims.length - 1; i >= 0; i--) if (anims[i].node === node) anims.splice(i, 1); },
    animate(node, to, ms = 380) {
      this.cancel(node);
      if (reducedMotion) { node.translation = new X3D.SFVec3f(...to); return; }
      const p = node.translation;
      anims.push({ node, from: [p.x, p.y, p.z], to, t0: performance.now(), ms });
    },
  };
  const views = layout.origins.map((origin, i) => new BoardView(ctx, i, origin));
  const byId = new Map(views.map((v, i) => [`g${i}`, v])), gate = new RenderEventGate(boards);
  const records = new GameRecords(), panel = panelEl ? new GamePanel(panelEl, records) : null;
  const rig = createCameraRig(browser, { boardOrigin: (i) => views[i].origin, ms: reducedMotion ? 1 : 900 });
  const ps = await createPhaseSpace(browser, layout.phaseOrigin, boards);
  let selected = null, themeName = "neon", lastPanel = 0;
  const select = (i) => {
    if (disposed || !Number.isInteger(i) || i < 0 || i >= boards) return;
    selected = i; rig.board(i); panel?.show(i);
  };
  const deselect = () => { selected = null; rig.overview(); panel?.hide(); };
  const touchCallbacks = views.map((v, i) => {
    const key = `touch${i}`, field = v.proto.getField("touchTime");
    field.addFieldCallback(key, () => select(i)); return { field, key };
  });
  const setTheme = (name) => {
    if (!Object.hasOwn(THEMES, name)) return Promise.reject(new RangeError("Unknown chess theme"));
    themeQueue = themeQueue.catch(() => {}).then(async () => {
      if (disposed) return;
      themeName = name; const t = THEMES[name]; ctx.theme = t; setPieceTheme(t);
      world.getNamedNode("bg").skyColor = new X3D.MFColor(new X3D.SFColor(...t.bg.split(" ").map(Number)));
      await Promise.all(views.map((v) => v.applyTheme(t)));
      views.forEach((v) => v.lastEval != null && v.setEval(v.lastEval));
    });
    return themeQueue;
  };
  const loop = (now) => {
    if (disposed) return;
    rig.tick(now);
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i], k = Math.min(1, Math.max(0, (now - a.t0) / a.ms)), e = k * k * (3 - 2 * k);
      a.node.translation = new X3D.SFVec3f(
        a.from[0] + (a.to[0] - a.from[0]) * e,
        a.from[1] + (a.to[1] - a.from[1]) * e + Math.sin(Math.PI * k) * 0.7,
        a.from[2] + (a.to[2] - a.from[2]) * e);
      if (k >= 1) anims.splice(i, 1);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const stats = { moves: 0, complete: 0, tactics: 0, critical: 0, phase: 0, bursts: 0, dropped: 0, errors: 0, lastError: null };
  const settled = () => Promise.all([themeQueue, ...views.map((v) => v.settled())]);
  return {
    browser, layout, gridXml, views, stats, phase: ps, rig, records, panel,
    select, deselect, get selected() { return selected; },
    nextBoard: (d) => select(((selected ?? (d < 0 ? 0 : -1)) + Math.sign(d) + boards) % boards),
    setTheme, get theme() { return themeName; },
    cycleTheme: () => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(themeName) + 1) % THEME_ORDER.length]),
    setHeat: (on) => Promise.all(views.map((v) => v.setHeat(on))),
    setStudyHighlights: (data, index = 0) => {
      if (!Number.isInteger(index) || !views[index]) return Promise.reject(new RangeError("Unknown study board"));
      return views[index].setStudyHighlights(data);
    },
    clearStudyHighlights: (index = 0) => {
      if (!views[index]) return;
      views[index].studyRevision++;
      if (views[index].studyFx) views[index].studyFx.children = new X3D.MFNode();
    },
    graphCount: () => views.filter((v) => v.evals.length).length,
    heatPainted: () => views.filter((v) => v.heat && v.heat.visible).length,
    misplaced() {
      let bad = 0;
      for (const v of views) for (const [sq, e] of v.nodes) {
        const t = sqPos(sq, v.origin), p = e.node.translation;
        if (Math.abs(p.x - t[0]) + Math.abs(p.y - t[1]) + Math.abs(p.z - t[2]) > 1e-3) bad++;
      }
      return bad;
    },
    settled,
    childCount: () => views.reduce((n, v) => n + v.childCount(), 0),
    pieceCount: () => views.reduce((n, v) => n + v.nodes.size, 0),
    async exportX3D() {
      await settled();
      if (disposed || typeof world.toXMLString !== "function") throw new Error("This X3D scene cannot be serialized");
      return world.toXMLString();
    },
    async onEvent(ev) {
      if (disposed) return false;
      const v = byId.get(ev?.game_id);
      if (!v) return false;
      try {
        if (["snapshot_game", "snapshot", "move"].includes(ev.type)) {
          if (typeof ev.fen !== "string" || ev.fen.length > 256) throw new Error("Invalid board FEN");
          new Chess(ev.fen); // Validate the full FEN before advancing generation/sequence acceptance.
          fenPlacement(ev.fen);
        }
        const accepted = gate.accept(ev);
        if (!accepted) { stats.dropped++; return false; }
        if (ev.type === "snapshot") ev = { ...ev, type: "snapshot_game" };
        records.onEvent(ev);
        if (accepted.generationChanged || accepted.snapshot) ps.reset(ev.game_id);
        if (ev.type === "snapshot_game" || ev.type === "move") {
          v.lastEval = Number.isFinite(ev.eval_cp) ? ev.eval_cp : null;
          v.setEval(v.lastEval);
          if (accepted.snapshot) await v.reset(ev.fen);
          else {
            stats.moves++; if (ev.tactics?.length) stats.tactics++; if (ev.critical) stats.critical++;
            const jobs = [v.apply(ev.fen), v.showMove(ev.uci, ev.tactics, moveExtra(ev))];
            if (v.lastEval != null) jobs.push(v.pushEval(v.lastEval));
            if (ev.captured && ev.uci && !reducedMotion) {
              stats.bursts++;
              void burst(browser, sqPos(ev.uci.slice(2, 4), v.origin), themeName === "ice" ? "0.2 0.4 1" : "1 0.5 0.15", { isAlive: () => !disposed }).then((cleanup) => {
                if (!cleanup) return;
                if (disposed) cleanup(); else { burstCleanups.add(cleanup); setTimeout(() => burstCleanups.delete(cleanup), 800); }
              });
            }
            await Promise.all(jobs);
          }
        } else if (ev.type === "game_complete") { stats.complete++; ps.reset(ev.game_id); }
        else if (ev.type === "phase_space_update") { stats.phase++; ps.update(ev); }
        if (panel && selected !== null && ev.game_id === `g${selected}` && performance.now() - lastPanel > 250) {
          lastPanel = performance.now(); panel.render();
        }
        return true;
      } catch (error) {
        stats.errors++; stats.lastError = error.message;
        onError?.(error, ev); return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; if (raf != null) cancelAnimationFrame(raf);
      for (const { field, key } of touchCallbacks) field.removeFieldCallback?.(key);
      views.forEach((v) => v.dispose()); ps.dispose();
      burstCleanups.forEach((cleanup) => cleanup()); burstCleanups.clear(); anims.length = 0;
      panel?.hide();
    },
  };
}
