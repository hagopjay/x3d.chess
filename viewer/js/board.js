// One board's pieces and overlays. New snapshots invalidate older async work.
import { pieceXml } from "./pieces.js";
import { moveFxXml, studyFxXml } from "./fx.js";
import { BoardLens } from "./lenses.js";
import { heatXml, heatColors, graphXml, graphPoints, GRAPH_LEN } from "./overlays.js";
const FILES = "abcdefgh";
export const validSquare = (sq) => typeof sq === "string" && /^[a-h][1-8]$/.test(sq);
export const sqPos = (sq, origin) => {
  if (!validSquare(sq)) throw new RangeError("Invalid chess square");
  return [origin[0] + FILES.indexOf(sq[0]) - 3.5, 0.05, origin[2] + 3.5 - (Number(sq[1]) - 1)];
};
export function fenPlacement(fen) {
  if (typeof fen !== "string") throw new TypeError("FEN must be text");
  const rows = fen.split(" ")[0].split("/"), map = {};
  if (rows.length !== 8) throw new Error("FEN placement needs eight ranks");
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/^[1-8]$/.test(ch)) f += Number(ch);
      else {
        if (!/^[prnbqkPRNBQK]$/.test(ch) || f >= 8) throw new Error("Invalid FEN piece placement");
        map[FILES[f++] + (8 - i)] = ch;
      }
      if (f > 8) throw new Error("FEN rank exceeds eight squares");
    }
    if (f !== 8) throw new Error("FEN rank needs eight squares");
  });
  return map;
}
const EMPTY = "<X3D profile='Interchange' version='4.0'><Scene><Group/></Scene></X3D>";
export class BoardView {
  constructor(ctx, index, origin) {
    this.ctx = ctx; this.index = index; this.origin = origin;
    this.nodes = new Map(); this.proto = ctx.browser.currentScene.getNamedNode(`board_${index}`);
    this.busy = Promise.resolve(); this.fxBusy = Promise.resolve();
    this.epoch = 0; this.fxRevision = 0; this.studyRevision = 0;
    this.heatOn = false; this.evals = []; this.evalKinds = []; this.disposed = false;
    this.lastEval = null; this.setEval(null);
    this.lens = new BoardLens(this);
  }
  _current(epoch) { return !this.disposed && epoch === this.epoch; }
  _queue(job) { const pending = this.busy.catch(() => {}).then(job); this.busy = pending; return pending; }
  async _ensureGroup() {
    if (this.group) return this.group;
    if (!this.groupPromise) this.groupPromise = this.ctx.browser.createX3DFromString(EMPTY).then((s) => {
      if (this.disposed) return null;
      this.group = s.rootNodes[0]; this.ctx.browser.currentScene.addRootNode(this.group); return this.group;
    }).finally(() => { this.groupPromise = null; });
    return this.groupPromise;
  }
  apply(fen) {
    fenPlacement(fen);
    const epoch = this.epoch;
    return this._queue(() => this._current(epoch) && this._reconcile(fen, epoch));
  }
  reset(fen, generation) {
    fenPlacement(fen); const epoch = ++this.epoch;
    this.clearEffects(); this.resetEvals(); this.lastFen = null; this.lens.onReset(generation);
    for (const entry of this.nodes.values()) this.ctx.cancel?.(entry.node);
    return this._queue(async () => {
      if (!this._current(epoch)) return;
      if (this.group) this.group.children = new X3D.MFNode();
      this.nodes.clear(); await this._reconcile(fen, epoch);
    });
  }
  async _create(chs, squares, epoch) {
    const xml = `<Group>${chs.map((ch) => pieceXml(ch.toLowerCase(), ch === ch.toLowerCase() ? "b" : "w", this.pieceTheme || this.ctx.theme)).join("")}</Group>`;
    const s = await this.ctx.browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><Scene>${xml}</Scene></X3D>`);
    const group = await this._ensureGroup();
    if (!this._current(epoch) || !group) return [];
    const kids = [...s.rootNodes[0].children];
    for (const k of kids) group.children.push(k);
    return kids.map((node, i) => { node.translation = new X3D.SFVec3f(...sqPos(squares[i], this.origin)); return node; });
  }
  _remove(entry) {
    this.ctx.cancel?.(entry.node);
    if (this.group) this.group.children = new X3D.MFNode(...[...this.group.children].filter((n) => n !== entry.node));
  }
  async showMove(uci, tactics, extra) {
    const revision = ++this.fxRevision, epoch = this.epoch;
    const pending = this.fxBusy.catch(() => {}).then(async () => {
      if (!this._current(epoch) || revision !== this.fxRevision) return;
      const s = await this.ctx.browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><Scene>${moveFxXml(uci, tactics, this.origin, extra)}</Scene></X3D>`);
      if (!this._current(epoch) || revision !== this.fxRevision) return;
      if (!this.fx) {
        const group = await this.ctx.browser.createX3DFromString(EMPTY);
        if (!this._current(epoch) || revision !== this.fxRevision) return;
        this.fx = group.rootNodes[0]; this.ctx.browser.currentScene.addRootNode(this.fx);
      }
      this.fx.children = new X3D.MFNode(...s.rootNodes[0].children);
    });
    this.fxBusy = pending; return pending;
  }
  clearEffects() {
    this.fxRevision++; this.studyRevision++;
    this.fxBusy = this.fxBusy.catch(() => {});
    if (this.studyPending) this.studyPending = this.studyPending.catch(() => {});
    if (this.fx) this.fx.children = new X3D.MFNode();
    if (this.studyFx) this.studyFx.children = new X3D.MFNode();
  }
  setStudyHighlights(data) {
    this.studyPending = this._setStudyHighlights(data);
    return this.studyPending;
  }
  async _setStudyHighlights(data) {
    const xml = studyFxXml(data, this.origin), revision = ++this.studyRevision, epoch = this.epoch;
    const s = await this.ctx.browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><Scene>${xml}</Scene></X3D>`);
    if (!this._current(epoch) || revision !== this.studyRevision) return false;
    if (!this.studyFx) {
      const group = await this.ctx.browser.createX3DFromString(EMPTY);
      if (!this._current(epoch) || revision !== this.studyRevision) return false;
      this.studyFx = group.rootNodes[0]; this.ctx.browser.currentScene.addRootNode(this.studyFx);
    }
    this.studyFx.children = new X3D.MFNode(...s.rootNodes[0].children); return true;
  }
  async setHeat(on) {
    this.heatOn = Boolean(on);
    if (this.heatOn && !this.heat && !this.heatPromise) this.heatPromise = this.ctx.browser.createX3DFromString(heatXml(this.origin)).then((s) => {
      if (this.disposed) return;
      this.heat = s.rootNodes[0]; this.ctx.browser.currentScene.addRootNode(this.heat);
    }).finally(() => { this.heatPromise = null; });
    if (this.heatPromise) await this.heatPromise;
    if (this.heat && !this.disposed) {
      this.heat.visible = this.heatOn;
      if (this.heatOn && this.lastFen) this._paintHeat(this.lastFen);
    }
  }
  _paintHeat(fen) {
    const cols = heatColors(fen);
    this.heat.geometry.color.color = new X3D.MFColorRGBA(...cols.map((c) => new X3D.SFColorRGBA(...c)));
  }
  async pushEval(sample) {
    // Typed producer records preserve the distinction between a point score,
    // a bound, a mate report and an unavailable sample. Legacy numeric callers
    // remain supported, but the live controller supplies the complete record.
    const numeric = typeof sample === "number", kind = numeric ? "legacy" : sample?.evaluation_kind;
    const point = numeric || (kind === "engine_cp" && sample.score_bound === "exact") ||
      (kind === "material_proxy" && sample.score_bound == null);
    const raw = numeric ? sample : sample?.eval_cp, cp = point && Number.isFinite(raw) ? raw : null;
    this.evals.push(cp); this.evalKinds.push(kind ?? "unavailable");
    if (this.evals.length > GRAPH_LEN) { this.evals.shift(); this.evalKinds.shift(); }
    if (!this.graphScene && !this.graphPromise && !this.evals.some(Number.isFinite)) return;
    if (!this.graphScene && !this.graphPromise) this.graphPromise = this.ctx.browser.createX3DFromString(graphXml(this.origin)).then((s) => {
      if (this.disposed) return;
      this.graphScene = s; this.ctx.browser.currentScene.addRootNode(s.rootNodes[0]);
    }).finally(() => { this.graphPromise = null; });
    if (this.graphPromise) await this.graphPromise;
    if (!this.disposed) this._paintGraph();
  }
  _paintGraph() {
    if (!this.graphScene) return;
    // Unused gap coordinates lie on the baseline; no segment references them.
    // Keep their sample slots so a missing observation does not compress time.
    const pts = graphPoints(this.evals.map((cp) => cp ?? 0), this.origin), indices = [];
    let active = false, priorKind = null;
    for (const [i, cp] of this.evals.entries()) {
      const kind = this.evalKinds[i];
      if (active && (!Number.isFinite(cp) || kind !== priorKind)) { indices.push(-1); active = false; }
      if (Number.isFinite(cp)) { indices.push(i); active = true; priorKind = kind; }
    }
    if (active || !indices.length) indices.push(-1);
    this.graphScene.getNamedNode("graphc").point = new X3D.MFVec3f(...pts.map((p) => new X3D.SFVec3f(...p)));
    this.graphScene.getNamedNode("graphline").coordIndex = new X3D.MFInt32(...indices);
  }
  resetEvals() { this.evals = []; this.evalKinds = []; this._paintGraph(); }
  childCount() { return this.group ? this.group.children.length : 0; }
  async _reconcile(fen, epoch = this.epoch) {
    if (!this._current(epoch)) return;
    const changed = this.lastFen !== fen; this.lastFen = fen; if (this.heatOn && this.heat) this._paintHeat(fen);
    if (changed) this.lens.onPlacement(fen);
    const next = fenPlacement(fen), vacated = [];
    for (const [sq, entry] of this.nodes) {
      if (next[sq] === entry.ch) continue;
      vacated.push({ sq, entry }); this.nodes.delete(sq);
    }
    const need = Object.entries(next).filter(([sq, ch]) => !this.nodes.has(sq) && ch), toCreate = [];
    for (const [sq, ch] of need) {
      const i = vacated.findIndex((v) => v.entry.ch === ch);
      if (i >= 0) {
        const [{ entry }] = vacated.splice(i, 1);
        this.nodes.set(sq, entry); this.ctx.animate(entry.node, sqPos(sq, this.origin));
      } else toCreate.push([sq, ch]);
    }
    for (const v of vacated) this._remove(v.entry);
    if (toCreate.length) {
      const nodes = await this._create(toCreate.map((t) => t[1]), toCreate.map((t) => t[0]), epoch);
      if (!this._current(epoch)) return;
      toCreate.forEach(([sq, ch], i) => this.nodes.set(sq, { node: nodes[i], ch }));
    }
  }
  applyTheme(t) {
    this.pieceTheme = t;
    this.proto.darkColor = new X3D.SFColor(...t.dark.split(" ").map(Number));
    this.proto.lightColor = new X3D.SFColor(...t.light.split(" ").map(Number));
    this.setEval(this.lastEval); const epoch = this.epoch;
    return this._queue(async () => {
      if (!this._current(epoch)) return;
      for (const entry of this.nodes.values()) this.ctx.cancel?.(entry.node);
      if (this.group) this.group.children = new X3D.MFNode();
      this.nodes.clear(); if (this.lastFen) await this._reconcile(this.lastFen, epoch);
    });
  }
  setEval(cp) {
    if (!Number.isFinite(cp)) {
      this.proto.evalScale = new X3D.SFVec3f(0, 0, 0);
      this.proto.tintDark = new X3D.SFColor(0, 0, 0);
      this.proto.tintLight = new X3D.SFColor(0, 0, 0);
      return;
    }
    const p = Math.max(-8, Math.min(8, cp / 100)), k = 0.5 + p / 16;
    this.proto.evalScale = new X3D.SFVec3f(1, 1, Math.max(0.05, k));
    const th = this.ctx.theme, t = Math.min(1, Math.abs(p) / 4) * (th?.tint ?? 1);
    let r, g, b;
    if (th?.hue) {
      const h = (p >= 0 ? th.hue.w : th.hue.b).split(" ").map(Number);
      [r, g, b] = h.map((x) => x * t * 4);
      this.proto.tintDark = new X3D.SFColor(r, g, b);
      this.proto.tintLight = new X3D.SFColor(r * 0.5, g * 0.5, b * 0.5); return;
    }
    [r, g, b] = p >= 0 ? [0.02 * (t > 0), 0.03 * (t > 0) + 0.15 * t, 0.07 * (t > 0) + 0.2 * t] : [0.07 * (t > 0) + 0.2 * t, 0.02 * (t > 0), 0.07 * (t > 0) + 0.1 * t];
    this.proto.tintDark = new X3D.SFColor(r, g, b);
    this.proto.tintLight = new X3D.SFColor(r * 1.3, g * 1.3, b * 1.3);
  }
  settled() { return Promise.all([this.busy, this.fxBusy, this.heatPromise, this.graphPromise, this.studyPending, this.lens.settled()]); }
  dispose() {
    this.disposed = true; this.epoch++; this.clearEffects(); this.lens.dispose();
    for (const entry of this.nodes.values()) this.ctx.cancel?.(entry.node);
    for (const root of [this.group, this.fx, this.studyFx, this.heat, this.graphScene?.rootNodes[0]]) if (root) {
      try { this.ctx.browser.currentScene.removeRootNode(root); } catch {}
    }
    this.nodes.clear();
  }
}
