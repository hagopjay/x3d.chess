// Lenses: optional explanatory overlays layered over each board (terrain, concepts, square inspector,
// search branches, eval ribbon) and one tournament-level skyline. Every overlay is created once, painted
// synchronously after its last await, and guarded by a per-lens revision plus the board's epoch, so a late
// fragment can never commit onto a newer position or a reset board.
import { terrainXml, terrainUpdate, groupFlat, TERRAIN_MODES, LEGEND as TERRAIN_LEGEND } from "./terrain.js";
import { conceptsXml, conceptsReport, conceptGeometry, conceptUpdates, CONCEPT_IDS, LEGEND as CONCEPT_LEGEND } from "./concepts.js";
import * as insp from "./inspector.js";
import { acceptResult, verifyResult, branchGeometry, branchesXml, applyBranchesToScene, LEGEND as BRANCH_LEGEND, formatScore } from "./branches.js";
import { skylineLayout, skylineState, skylineUpdate, skylineReset, skylinePoints, skylineXml, ribbonXml, ribbonPoints, LEGEND as SKY_LEGEND } from "./skyline.js";

export { CONCEPT_IDS, TERRAIN_MODES };
export const LEGENDS = Object.freeze({ terrain: TERRAIN_LEGEND, concepts: CONCEPT_LEGEND, inspector: insp.LEGEND, branches: BRANCH_LEGEND, skyline: SKY_LEGEND });

const fragment = (browser, xml) => browser.createX3DFromString(xml);

/** Per-board overlay controller. `view` is the owning BoardView (uses view.ctx, view.origin, view.index, view.epoch). */
export class BoardLens {
  constructor(view) {
    this.view = view; this.origin = view.origin; this.index = view.index;
    this.mounts = new Map(); this.roots = []; this.pending = new Set();
    this.rev = { terrain: 0, concepts: 0, insp: 0, branches: 0, ribbon: 0 };
    this.terrainOn = false; this.terrainMode = "count"; this.conceptSel = []; this.ribbonOn = false;
    this.insp = insp.makeInspectorState(); this.lastInspection = null; this.branchLabels = [];
    this.history = []; this.generation = 0;
  }
  _track(p) { this.pending.add(p); const done = () => this.pending.delete(p); p.then(done, done); return p; }
  _alive(epoch) { return !this.view.disposed && epoch === this.view.epoch; }
  /** Single-flight creation of one named fragment; resolves to the scene fragment or null if disposed first. */
  _mount(name, xml) {
    if (!this.mounts.has(name)) {
      const p = fragment(this.view.ctx.browser, xml).then((s) => {
        if (this.view.disposed) return null;
        const root = s.rootNodes[0]; this.view.ctx.browser.currentScene.addRootNode(root); this.roots.push(root); return s;
      });
      this.mounts.set(name, p); p.catch(() => this.mounts.delete(name));
    }
    return this.mounts.get(name);
  }
  // ---- terrain -----------------------------------------------------------------------------
  setTerrain(on, mode = this.terrainMode) {
    if (!Object.hasOwn(TERRAIN_MODES, mode)) throw new RangeError("Unknown terrain mode");
    this.terrainOn = Boolean(on); this.terrainMode = mode;
    return this._track(this._paintTerrain(this.view.lastFen));
  }
  async _paintTerrain(fen) {
    const rev = ++this.rev.terrain, epoch = this.view.epoch;
    if (!this.terrainOn && !this.mounts.has("terrain")) return;
    const s = await this._mount("terrain", terrainXml(this.origin, { def: `terrain${this.index}` }));
    if (!s || !this._alive(epoch) || rev !== this.rev.terrain) return;
    const shape = s.rootNodes[0];
    if (!this.terrainOn || !fen) { shape.visible = false; return; }
    const u = terrainUpdate(fen, this.origin, this.terrainMode), X = globalThis.X3D;
    shape.geometry.coord.point = new X.MFVec3f(...groupFlat(u.points, 3).map((p) => new X.SFVec3f(...p)));
    shape.geometry.color.color = new X.MFColorRGBA(...groupFlat(u.colors, 4).map((c) => new X.SFColorRGBA(...c)));
    shape.visible = true;
  }
  // ---- concepts ----------------------------------------------------------------------------
  setConcepts(selection) {
    const sel = [...new Set(selection)];
    for (const id of sel) if (!CONCEPT_IDS.includes(id)) throw new RangeError(`Unknown concept ${id}`);
    this.conceptSel = sel;
    return this._track(this._paintConcepts(this.view.lastFen));
  }
  async _paintConcepts(fen) {
    const rev = ++this.rev.concepts, epoch = this.view.epoch, prefix = `cx${this.index}`;
    if (!this.conceptSel.length && !this.mounts.has("concepts")) return;
    const s = await this._mount("concepts", conceptsXml(this.origin, { prefix }));
    if (!s || !this._alive(epoch) || rev !== this.rev.concepts) return;
    const report = fen ? conceptsReport(fen) : null;
    if (!report) return;
    const X = globalThis.X3D, geo = conceptGeometry(report, this.origin, this.conceptSel);
    for (const u of conceptUpdates(geo, { prefix })) {
      const n = s.getNamedNode(u.def);
      if (u.field === "point") n.point = new X.MFVec3f(...u.value.map((p) => new X.SFVec3f(...p)));
      else if (u.field === "coordIndex") n.coordIndex = new X.MFInt32(...u.value);
      else if (u.field === "visible") n.visible = u.value;
    }
    this.conceptReport = report;
  }
  // ---- inspector ---------------------------------------------------------------------------
  inspect(square) {
    const fen = this.view.lastFen;
    if (!fen || !insp.validSquare(square)) return Promise.resolve(null);
    const epoch = insp.selectSquare(this.insp, fen, square);   // revision bumps before any await
    return this._track(this._paintInspection(epoch, fen, square));
  }
  clearInspection() {
    insp.clearSelection(this.insp); this.lastInspection = null;
    return this._track(this._paintInspection(null));
  }
  async _paintInspection(epoch, fen, square) {
    const view = this.view, viewEpoch = view.epoch;
    const s = await this._mount("insp", insp.inspectorXml(this.origin, { def: `insp${this.index}` }));
    if (!s || !this._alive(viewEpoch)) return null;
    if (!epoch) { insp.applyInspectorGeometry(s, insp.inspectorGeometry(null, this.origin), globalThis.X3D, `insp${this.index}`); return null; }
    const ins = insp.inspect(fen, square, epoch);
    if (!insp.acceptInspection(this.insp, ins)) return null;
    insp.applyInspectorGeometry(s, insp.inspectorGeometry(ins, this.origin), globalThis.X3D, `insp${this.index}`);
    this.lastInspection = ins; return ins;
  }
  // ---- search branches ---------------------------------------------------------------------
  async showBranches(result) {
    const rev = ++this.rev.branches, epoch = this.view.epoch;
    if (!result || !acceptResult(this.view.lastFen, result).accepted) return false;
    const { lines } = verifyResult(result), geom = branchGeometry(result.fenSearched, lines, this.origin);
    const s = await this._mount("branches", branchesXml(this.origin));
    if (!s || !this._alive(epoch) || rev !== this.rev.branches || this.view.lastFen !== result.fenSearched) return false;
    applyBranchesToScene(s, geom, undefined, globalThis.X3D);
    this.branchLabels = geom.map((g) => g.label); return geom.length > 0;
  }
  clearBranches() {
    this.rev.branches++; this.branchLabels = [];
    const p = this.mounts.get("branches");
    if (p) this._track(p.then((s) => { if (s && !this.view.disposed) applyBranchesToScene(s, [], undefined, globalThis.X3D); }));
  }
  // ---- eval ribbon -------------------------------------------------------------------------
  pushScore(rec) { this.history.push(rec ?? null); if (this.history.length > 240) this.history.shift(); if (this.ribbonOn) this._track(this._paintRibbon()); }
  setRibbon(on) { this.ribbonOn = Boolean(on); return this._track(this._paintRibbon()); }
  async _paintRibbon() {
    const rev = ++this.rev.ribbon, epoch = this.view.epoch;
    if (!this.ribbonOn && !this.mounts.has("ribbon")) return;
    const s = await this._mount("ribbon", ribbonXml(this.origin, { def: `ribbon${this.index}` }));
    if (!s || !this._alive(epoch) || rev !== this.rev.ribbon) return;
    const shape = s.rootNodes[0];
    if (!this.ribbonOn) { shape.visible = false; return; }
    const X = globalThis.X3D, r = ribbonPoints(this.history, this.origin);
    shape.geometry.coordIndex = new X.MFInt32();
    shape.geometry.coord.point = new X.MFVec3f(...groupFlat(r.points, 3).map((p) => new X.SFVec3f(...p)));
    shape.geometry.color.color = new X.MFColorRGBA(...groupFlat(r.colors, 4).map((c) => new X.SFColorRGBA(...c)));
    shape.geometry.coordIndex = new X.MFInt32(...r.coordIndex);
    shape.visible = true;
  }
  // ---- lifecycle hooks called by BoardView ------------------------------------------------
  /** A new placement was committed (view.lastFen is current). */
  onPlacement(fen) {
    this.clearBranches();
    if (this.terrainOn) this._track(this._paintTerrain(fen));
    if (this.conceptSel.length) this._track(this._paintConcepts(fen));
    if (this.insp.square) this.inspect(this.insp.square);
  }
  /** Board reset (new game or snapshot): clear every claim tied to the old episode. */
  onReset(generation) {
    if (Number.isInteger(generation) && generation >= this.insp.gen) insp.newGeneration(this.insp, generation);
    else insp.clearSelection(this.insp);
    this.lastInspection = null; this.history = []; this.conceptReport = null;
    for (const k of Object.keys(this.rev)) this.rev[k]++;
    this.clearBranches();
    if (this.mounts.has("insp")) this._track(this._paintInspection(null));
    if (this.ribbonOn) this._track(this._paintRibbon());
  }
  settled() { return Promise.allSettled([...this.pending]); }
  dispose() {
    for (const root of this.roots) { try { this.view.ctx.browser.currentScene.removeRootNode(root); } catch {} }
    this.roots = []; this.mounts.clear();
  }
}

/** Tournament-level skyline above the board grid: columns per board + score bookkeeping with stale guards. */
export class SkylineLayer {
  constructor(browser, layout, boards) {
    this.browser = browser; this.layout = layout; this.boards = boards;
    this.state = skylineState(skylineLayout(layout, boards)); this.on = false; this.scene = null; this.rev = 0; this.disposed = false;
    this.pendingMount = null; this.pending = new Set();
  }
  update(index, rec, generation, seq) {
    const r = skylineUpdate(this.state, index, rec, generation, seq);
    if (r.accepted && this.on) this._repaint();
    return r;
  }
  reset(index = null) { skylineReset(this.state); if (this.on) this._repaint(); }
  async setVisible(on) {
    this.on = Boolean(on);
    if (!this.scene && !this.pendingMount && this.on) {
      this.pendingMount = fragment(this.browser, skylineXml(this.layout, this.boards)).then((s) => {
        if (this.disposed) return null; this.scene = s; this.browser.currentScene.addRootNode(s.rootNodes[0]); return s;
      }).finally(() => { this.pendingMount = null; });
    }
    if (this.pendingMount) await this.pendingMount;
    if (!this.scene || this.disposed) return;
    this.scene.rootNodes[0].visible = this.on;
    if (this.on) this._repaint();
  }
  _repaint() {
    if (!this.scene || this.disposed) return;
    const u = skylinePoints(this.state), X = globalThis.X3D, pts = groupFlat(u.points, 3).map((p) => new X.SFVec3f(...p)), s = this.scene;
    const fill = s.getNamedNode("skyline_fill"), line = s.getNamedNode("skyline_outline");
    fill.geometry.coord.point = new X.MFVec3f(...pts);
    fill.geometry.color.color = new X.MFColorRGBA(...groupFlat(u.colors, 4).map((c) => new X.SFColorRGBA(...c)));
    line.geometry.coord.point = new X.MFVec3f(...pts);
    line.geometry.color.color = new X.MFColorRGBA(...groupFlat(u.outlineColors, 4).map((c) => new X.SFColorRGBA(...c)));
    u.labels.forEach((label, i) => { const t = s.getNamedNode(`skyline_text${i}`); if (t) t.string = new X.MFString(label); });
  }
  details() { return skylinePoints(this.state).details; }
  dispose() {
    this.disposed = true;
    if (this.scene) { try { this.browser.currentScene.removeRootNode(this.scene.rootNodes[0]); } catch {} }
    this.scene = null;
  }
}

/** One-line summaries for the lens readout (text only, no claims beyond the modules' own legends). */
export function describeInspection(ins) {
  if (!ins) return "";
  const p = ins.piece ? `${ins.piece.color === "w" ? "White" : "Black"} ${ins.piece.type.toUpperCase()}` : "empty square";
  const dest = ins.legal?.destinations?.length;
  const bits = [`${ins.square}: ${p}`];
  if (ins.piece) {
    bits.push(`attacked by ${ins.enemyAttackers.length}, defended by ${ins.defenders.length} (geometric)`);
    bits.push(!ins.legal?.sideToMove ? "legal destinations: n/a (not the side to move)" : `${dest} legal destination${dest === 1 ? "" : "s"}`);
    if (ins.pin.pinned) bits.push(`absolutely pinned by ${ins.pin.pinner}`);
  } else bits.push(`attack balance ${ins.control.balance >= 0 ? "+" : ""}${ins.control.balance}`);
  if (ins.position.doubleCheck) bits.push("double check");
  return bits.join(" · ");
}
export { formatScore };
