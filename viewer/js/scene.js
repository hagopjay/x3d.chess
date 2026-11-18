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
import { SkylineLayer, CONCEPT_IDS, LEGENDS, describeInspection } from "./lenses.js";
import { validSquare } from "./board.js";
import * as inspector from "./inspector.js";

function moveExtra(ev) {
  const extra = { captured: !!ev.captured };
  if (/[+#]$/.test(ev.san || "")) {
    const king = fenPlacement(ev.fen), want = ev.fen.split(" ")[1] === "w" ? "K" : "k";
    extra.checkSq = Object.keys(king).find((sq) => king[sq] === want);
  }
  return extra;
}

export async function createScene(browser, { boards = 20, cols = 5, pitch = 10, panelEl = null, onError = null, onLens = null, reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false } = {}) {
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
  const dist = Math.max(layout.width, layout.height) * 0.75;      // low oblique pose that frames the skyline plane (y = 4 +- 2.4) above the boards
  const rig = createCameraRig(browser, { boardOrigin: (i) => views[i].origin, skylinePose: { p: [0, 4 + dist * 0.22, layout.height / 2 + dist * 0.85], o: [1, 0, 0, -0.30] }, ms: reducedMotion ? 1 : 900 });
  const ps = await createPhaseSpace(browser, layout.phaseOrigin, boards);
  const sky = new SkylineLayer(browser, layout, boards);
  const lensState = { terrain: false, mode: "count", concept: -1, inspect: false, skyline: false, readout: "" };
  let selected = null, themeName = "neon", lastPanel = 0, fallbackSeq = 0;
  const lastHit = new Array(boards).fill(null);
  const squareAt = (p) => {                                    // TouchSensor hit point is board-local: files along +x, rank 1 at +z
    const f = Math.floor(p.x + 4), r = 8 - Math.floor(p.z + 4);
    return f >= 0 && f < 8 && r >= 1 && r <= 8 ? "abcdefgh"[f] + r : null;
  };
  const note = (text) => { lensState.readout = text; onLens?.(text); };
  const inspectAt = async (i, square) => {
    if (disposed || !validSquare(square)) return null;
    const ins = await views[i].lens.inspect(square);
    if (ins && !disposed && lensState.inspect && selected === i) note(describeInspection(ins));
    return ins;
  };
  const select = (i) => {
    if (disposed || !Number.isInteger(i) || i < 0 || i >= boards) return;
    selected = i; rig.board(i); panel?.show(i);
  };
  const deselect = () => { selected = null; rig.overview(); panel?.hide(); if (lensState.inspect) { views.forEach((v) => v.lens.clearInspection()); note(""); } };
  const touchCallbacks = views.map((v, i) => {
    const key = `touch${i}`, field = v.proto.getField("touchTime");
    const hit = v.proto.getField("hitPoint"), hitKey = `hit${i}`;
    hit.addFieldCallback(hitKey, (p) => { lastHit[i] = p; });
    field.addFieldCallback(key, () => {
      const wasSelected = selected === i; select(i);
      const sq = lensState.inspect && lastHit[i] ? squareAt(lastHit[i]) : null;
      if (sq && (wasSelected || selected === i)) void inspectAt(i, sq);
    }); return { field, key, hit, hitKey };
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
    // ---- lenses (all optional, off by default) ----
    lensState, sky, LEGENDS, CONCEPT_IDS,
    setTerrain: async (on, mode = lensState.mode) => { lensState.terrain = Boolean(on); lensState.mode = mode; await Promise.all(views.map((v) => v.lens.setTerrain(on, mode))); },
    cycleTerrainMode: async () => { const m = lensState.mode === "count" ? "material" : "count"; await Promise.all(views.map((v) => v.lens.setTerrain(lensState.terrain, m))); lensState.mode = m; return m; },
    cycleConcept: async () => {                                   // none -> each concept alone -> none: one named relationship per picture
      lensState.concept = lensState.concept + 1 >= CONCEPT_IDS.length ? -1 : lensState.concept + 1;
      const sel = lensState.concept < 0 ? [] : [CONCEPT_IDS[lensState.concept]];
      await Promise.all(views.map((v) => v.lens.setConcepts(sel))); return sel[0] ?? null;
    },
    setInspect: async (on) => {
      lensState.inspect = Boolean(on);
      if (!on) { views.forEach((v) => v.lens.clearInspection()); note(""); return; }
      if (selected === null) select(0);
      await inspectAt(selected, views[selected].lens.insp.square ?? inspector.NAV_START);
    },
    inspectKey: async (key, mods) => {
      if (!lensState.inspect || selected === null) return false;
      const r = inspector.navigate(views[selected].lens.insp.square, key, mods);
      if (!r.handled) return false;
      if (r.square) await inspectAt(selected, r.square); else { views[selected].lens.clearInspection(); note(""); }
      return true;
    },
    showBranches: async (result) => (selected === null ? false : views[selected].lens.showBranches(result)),
    get branchLabels() { return selected === null ? [] : views[selected].lens.branchLabels; },
    setSkyline: async (on) => { lensState.skyline = Boolean(on); await sky.setVisible(on); await Promise.all(views.map((v) => v.lens.setRibbon(on))); },
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
          const rec = { evaluation_kind: ev.evaluation_kind, eval_cp: ev.eval_cp ?? null, mate_in: ev.mate_in ?? null, score_bound: ev.score_bound ?? null, eval_fen: ev.eval_fen ?? null, eval_ply: ev.eval_ply ?? null };
          sky.update(Number(ev.game_id.slice(1)), rec, ev.generation ?? 0, ev.seq ?? ++fallbackSeq);
          if (accepted.snapshot) { await v.reset(ev.fen, ev.generation); v.lens.pushScore(rec); }
          else {
            stats.moves++; if (ev.tactics?.length) stats.tactics++; if (ev.critical) stats.critical++;
            v.lens.pushScore(rec);
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
      for (const { field, key, hit, hitKey } of touchCallbacks) { field.removeFieldCallback?.(key); hit.removeFieldCallback?.(hitKey); }
      sky.dispose();
      views.forEach((v) => v.dispose()); ps.dispose();
      burstCleanups.forEach((cleanup) => cleanup()); burstCleanups.clear(); anims.length = 0;
      panel?.hide();
    },
  };
}
