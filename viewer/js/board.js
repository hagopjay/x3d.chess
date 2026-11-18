// BoardView: one board in the grid. Keeps a square->node map and reconciles it with each FEN.
import { pieceXml } from "./pieces.js";
import { moveFxXml } from "./fx.js";

const FILES = "abcdefgh";
export const sqPos = (sq, origin) => [origin[0] + FILES.indexOf(sq[0]) - 3.5, 0.05, origin[2] + 3.5 - (Number(sq[1]) - 1)];

export function fenPlacement(fen) {
  const map = {};
  fen.split(" ")[0].split("/").forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else { map[FILES[f] + (8 - i)] = ch; f++; }
    }
  });
  return map;
}

export class BoardView {
  constructor(ctx, index, origin) {
    this.ctx = ctx; this.index = index; this.origin = origin;
    this.nodes = new Map();       // square -> {node, ch}
    this.proto = ctx.browser.currentScene.getNamedNode(`board_${index}`);
    this.busy = Promise.resolve();
    this.group = null;            // per-board <Group> holding this board's piece nodes (created lazily)
  }

  async _ensureGroup() {
    if (this.group) return;
    const s = await this.ctx.browser.createX3DFromString("<X3D profile='Interchange' version='4.0'><Scene><Group/></Scene></X3D>");
    this.group = s.rootNodes[0];
    this.ctx.browser.currentScene.addRootNode(this.group);
  }

  /** Serialise updates so async node creation cannot interleave. */
  apply(fen) { this.busy = this.busy.then(() => this._reconcile(fen)); return this.busy; }

  async _create(chs, squares) {
    const xml = `<Group>${chs.map((ch) => pieceXml(ch.toLowerCase(), ch === ch.toLowerCase() ? "b" : "w")).join("")}</Group>`;
    const s = await this.ctx.browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><Scene>${xml}</Scene></X3D>`);
    await this._ensureGroup();
    const kids = [...s.rootNodes[0].children];
    for (const k of kids) this.group.children.push(k);
    return kids.map((node, i) => {
      const [x, y, z] = sqPos(squares[i], this.origin);
      node.translation = new X3D.SFVec3f(x, y, z);
      return node;
    });
  }

  _remove(entry) {
    const keep = [...this.group.children].filter((n) => n !== entry.node);
    this.group.children = new X3D.MFNode(...keep);
  }
  /** Last-move highlight + tactic lines; replaced by the next move, so nothing accumulates. */
  async showMove(uci, tactics) {
    this.fxBusy = (this.fxBusy || Promise.resolve()).then(async () => {
      const s = await this.ctx.browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><Scene>${moveFxXml(uci, tactics, this.origin)}</Scene></X3D>`);
      if (!this.fx) { this.fx = (await this.ctx.browser.createX3DFromString("<X3D profile='Interchange' version='4.0'><Scene><Group/></Scene></X3D>")).rootNodes[0]; this.ctx.browser.currentScene.addRootNode(this.fx); }
      this.fx.children = new X3D.MFNode(...s.rootNodes[0].children);
    });
    return this.fxBusy;
  }
  childCount() { return this.group ? this.group.children.length : 0; }

  async _reconcile(fen) {
    const next = fenPlacement(fen);
    // 1. squares that are unchanged keep their node
    const vacated = [];                    // [{sq, entry}]
    for (const [sq, entry] of this.nodes) {
      if (next[sq] === entry.ch) continue;
      vacated.push({ sq, entry }); this.nodes.delete(sq);
    }
    const need = Object.entries(next).filter(([sq, ch]) => !this.nodes.has(sq) && ch);
    const toCreate = [];
    for (const [sq, ch] of need) {
      const i = vacated.findIndex((v) => v.entry.ch === ch);
      if (i >= 0) {                        // a same-kind piece left some square: it moved here
        const [{ entry }] = vacated.splice(i, 1);
        this.nodes.set(sq, entry);
        this.ctx.animate(entry.node, sqPos(sq, this.origin));
      } else toCreate.push([sq, ch]);
    }
    for (const v of vacated) this._remove(v.entry);   // captured / promoted away
    if (toCreate.length) {
      const nodes = await this._create(toCreate.map((t) => t[1]), toCreate.map((t) => t[0]));
      toCreate.forEach(([sq, ch], i) => this.nodes.set(sq, { node: nodes[i], ch }));
    }
  }

  /** eval in centipawns, white-positive. Bar length and board tint follow the original EvalTinter idea. */
  setEval(cp) {
    const p = Math.max(-8, Math.min(8, cp / 100));
    const k = 0.5 + p / 16;
    this.proto.evalScale = new X3D.SFVec3f(1, 1, Math.max(0.05, k));
    const t = Math.min(1, Math.abs(p) / 4);
    const [r, g, b] = p >= 0 ? [0.02, 0.03 + 0.15 * t, 0.07 + 0.2 * t] : [0.07 + 0.2 * t, 0.02, 0.07 + 0.1 * t];
    this.proto.tintDark = new X3D.SFColor(r, g, b);
    this.proto.tintLight = new X3D.SFColor(r * 1.3, g * 1.3, b * 1.3);
  }
}
