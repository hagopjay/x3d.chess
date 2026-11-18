// TOURNAMENT SKYLINE: one translucent column per board floating above the board grid, plus a per-board
// "eval history ribbon" wall behind each board.
//
// What it shows (and only this): the LAST ACCEPTED SCORE RECORD of each board, white-perspective, as
// reported by the producer (see docs/PROTOCOL.md "Evaluation identity and kind"). It is NOT a win
// probability and NOT a proof; an engine score is search-dependent (depth, hash, nodes, bound). A material
// proxy is not an engine score. Mate is typed (mate_in), never an extreme centipawn number.
//
// HEIGHT CURVE (documented, linear, clipped):  y_cap = BASE_Y + clamp(cp / 100, -6, 6) * 0.4
//   i.e. 0.4 units per pawn, saturating at +-6 pawns (+-2.4 units). |cp| > 600 is "clipped" (amber cap).
//   Columns grow UP from the baseline plane for white-ahead scores and DOWN for black-ahead scores.
//   cp = 0 is a full-width hairline slab (min thickness 0.04).
// ENCODING (each is also a LEGEND string)
//   tint     cyan = white ahead, magenta = black ahead (engine);  lime / orange = material proxy
//   amber cap  |cp| > 600, height clipped
//   mate     height fixed at the clip height, flat cap ivory (white mates) / violet (black mates), label "+M3"
//   hollow   score_bound lowerbound / upperbound / unknown: near-transparent faces + opaque outline
//   no score narrow grey slab centred on the baseline (not a zero, not a draw), label "no score"
//
// PUBLIC API
//   SKY (constants), LEGEND (honest label strings), normalizeScore(rec) -> {ok, score|reason}
//   skylineLayout(layout, boardCount) -> {boards, baseY, maxH, half, columns[{index,origin,center,footprint,labelPos}]}
//        layout is the gridLayout() result; boardCount 1..64 (<= layout.boards). Columns sit above board origins.
//   skylineState(sl) -> mutable state (per-board score, generation, seq; revision counter)
//   skylineUpdate(state, boardIndex, scoreRecord, generation, seq) -> {accepted, reason, revision}
//        Rejects stale (older generation, seq <= last seq within a generation), bad index/counters and malformed
//        records; rejected updates never advance the guards. scoreRecord null = explicit "no score".
//   skylineReset(state, {guards=false}) -> clears scores (guards kept unless guards:true); bumps revision
//   skylinePoints(state) -> {points[24N], colors[20N], outlineColors[24N], labels[N], details[N], revision}
//        points: 8 vertices per column (ring A y0..3 at baseline side, ring B 4..7 at the value end), flat xyz.
//        colors: RGBA per FACE (5 faces per column: cap, then 4 sides). outlineColors: RGBA per polyline
//        (6 per column: ring A, ring B, 4 verticals).
//   skylineHeight(cp) -> signed height offset from the baseline (the documented curve)
//   skylineXml(layout, n, {def='skyline'}) -> full X3D 4.0 Interchange document string: Group(visible=false) with
//        Shape/IndexedFaceSet DEF <def>_fill (Coordinate <def>_coord, ColorRGBA <def>_color), Shape/IndexedLineSet
//        DEF <def>_outline (Coordinate <def>_ocoord, ColorRGBA <def>_ocolor) and n Text nodes DEF <def>_text<i>.
//   ribbonPoints(history, origin) -> {points, coordIndex, colors, faces, runs, gaps, mates, window}
//        history: array of score records | plain numbers (cp, kind unspecified) | null. Last 60 entries; x = slot.
//        No face ever spans a gap (null/unavailable), a mate sample, or a change of score kind.
//   ribbonXml(origin, {def='ribbon'}) -> empty ribbon document (Shape DEF <def>, Coordinate <def>_coord, ColorRGBA <def>_color)
//   groupFlat(flat, k)
//
// INTEGRATION (lead adds; this file touches nothing shared)
//   Once, at scene build, after gridLayout() and the board PROTO instances:
//     const sl = skylineLayout(layout, boards), st = skylineState(sl);
//     const doc = await browser.createX3DFromString(skylineXml(layout, boards));
//     browser.currentScene.addRootNode(doc.rootNodes[0]);
//     const fill = doc.getNamedNode('skyline_fill'), line = doc.getNamedNode('skyline_outline');
//     const texts = layout.origins.slice(0, boards).map((_, i) => doc.getNamedNode('skyline_text' + i));
//     (the Group is created visible=false so the board TouchSensor is never occluded until the user asks)
//   Toggle: key/button 'K' sets doc.rootNodes[0].visible = !visible. All Shapes have pointerEvents=false.
//   On each accepted snapshot_game / move event (after RenderEventGate.accept), build the record from the event:
//     const rec = { evaluation_kind: ev.evaluation_kind, eval_cp: ev.eval_cp, mate_in: ev.mate_in,
//                   score_bound: ev.score_bound, eval_fen: ev.eval_fen, eval_ply: ev.eval_ply };
//     const r = skylineUpdate(st, boardIndex, rec, ev.generation, ev.seq);
//     if (r.accepted && visible) repaint(st);
//   repaint(st): const rev = ++skylineRev; const u = skylinePoints(st);   // synchronous, no await between read and write
//     fill.geometry.coord.point = new X3D.MFVec3f(...groupFlat(u.points,3).map(p => new X3D.SFVec3f(...p)));
//     fill.geometry.color.color = new X3D.MFColorRGBA(...groupFlat(u.colors,4).map(c => new X3D.SFColorRGBA(...c)));
//     line.geometry.color.color = (same with u.outlineColors); line.geometry.coord.point = same points as fill;
//     texts[i].string = new X3D.MFString(u.labels[i])  (only for labels that changed)
//   Revision guard: skylinePoints is a pure read of the state, so a repaint cannot be stale if all four writes
//     are made in one synchronous block. Do not await between building u and writing it.
//   Reset / new generation / dispose: skylineReset(st) on scene.reset(); a new snapshot with a higher generation is
//     accepted by skylineUpdate itself (seq restarts). On dispose remove doc.rootNodes[0] and drop st.
//   Ribbon: per board keep history = []; on each accepted score push the record (push null for a ply without a
//     score so slots stay aligned to plies); const r = ribbonPoints(history, origin); write r.points (3-groups) to
//     ribbon Coordinate, r.coordIndex to IFS.coordIndex (MFInt32), r.colors (4-groups) to ColorRGBA. The IFS needs
//     coordIndex written BEFORE colors if the lengths shrink. Clear history on reset/new generation.
//   Show LEGEND.* beside the toggle.
export const SKY = Object.freeze({
  BASE_Y: 4.0, K: 0.4, CLIP_PAWNS: 6, HALF: 0.9, NULL_HALF: 0.4, NULL_H: 0.15, MIN_H: 0.04, LABEL_PAD: 0.35,
  RIB_LEN: 60, RIB_BASE_Y: 1.6, RIB_K: 0.1, RIB_BACK: 4.4, RIB_WIDTH: 8, RIB_HAIR: 0.02,
});
const MAX_H = SKY.CLIP_PAWNS * SKY.K;

export const LEGEND = Object.freeze({
  title: "Skyline: last engine score per board (white perspective)",
  scope: "Not a probability and not a proof. An engine score depends on search depth, nodes and bound; a different search may give a different value.",
  height: "Column height = clamp(cp / 100, -6, 6) x 0.4 above (white ahead) or below (black ahead) the baseline plane; linear, saturates at 6 pawns.",
  tint: "Cyan = white ahead, magenta = black ahead (engine score). Lime / orange = material proxy, which is NOT an engine score.",
  clip: "Amber cap = the score is beyond 6 pawns and the column height is clipped; the label still shows the reported value.",
  mate: "Mate is typed, never a number: fixed full-height column, flat ivory (white mates) or violet (black mates) cap, label +M3 / -M3 (moves to mate as reported).",
  hollow: "Hollow outlined column = the engine marked the score as a lowerbound, upperbound or unknown bound (label LB / UB / bound?). Bound direction is as reported by the engine; it is not re-derived here. A score with no stated bound is drawn solid and labelled as reported.",
  none: "Narrow grey slab on the baseline, label 'no score' = no score available (null / unavailable / not yet received). It is not a zero evaluation and not a draw.",
  zero: "A full-width hairline slab is an exact reported 0 cp, which is an engine value, not 'no score'.",
  ribbon: "Ribbon wall behind each board: last 60 plies, x = sample slot, height = same curve. It breaks at every missing sample, mate sample and change of score kind; nothing is interpolated across a break.",
  proxy: "Material proxy = material balance recomputed after the move; not an engine search.",
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isInt = Number.isInteger;
const fail = (m, E = RangeError) => { throw new E(m); };
const BOUNDS = new Set(["exact", "lowerbound", "upperbound", "unknown"]);
const KINDS = new Set(["engine_cp", "engine_mate", "material_proxy", "unavailable"]);

/** The documented height curve: signed offset of the cap from the baseline. */
export function skylineHeight(cp) {
  if (!Number.isFinite(cp)) fail("cp must be finite", TypeError);
  return clamp(cp / 100, -SKY.CLIP_PAWNS, SKY.CLIP_PAWNS) * SKY.K;
}

const NONE = Object.freeze({ kind: "none", cp: null, mate: null, bound: null, fen: null, ply: null });
const bad = (reason) => ({ ok: false, reason });

/** Validate a score record (PROTOCOL.md vocabulary) and reduce it to a typed score. Never guesses a kind. */
export function normalizeScore(rec) {
  if (rec == null) return { ok: true, score: NONE };
  if (typeof rec === "number") return Number.isFinite(rec) ? { ok: true, score: { ...NONE, kind: "cp", cp: rec } } : bad("malformed:cp");
  if (typeof rec !== "object" || Array.isArray(rec)) return bad("malformed:record");
  const { evaluation_kind: k, eval_cp: cp, mate_in: mate, score_bound: bound, eval_fen: fen, eval_ply: ply } = rec;
  if (bound != null && !BOUNDS.has(bound)) return bad("malformed:score_bound");
  if (fen != null && (typeof fen !== "string" || fen.trim().split(/\s+/).length < 4)) return bad("malformed:eval_fen");
  if (ply != null && (!isInt(ply) || ply < 0)) return bad("malformed:eval_ply");
  const ident = { fen: fen ?? null, ply: ply ?? null, bound: bound ?? null };
  if (k == null) return cp == null && mate == null ? { ok: true, score: { ...NONE, ...ident } } : bad("malformed:missing_kind");
  if (!KINDS.has(k)) return bad("malformed:evaluation_kind");
  if (k === "unavailable") return cp == null && mate == null ? { ok: true, score: { ...NONE, ...ident } } : bad("malformed:inconsistent");
  if (k === "engine_mate") {
    if (!isInt(mate) || mate === 0) return bad("malformed:mate_in");
    return { ok: true, score: { kind: "mate", cp: null, mate, ...ident } };           // eval_cp (any value) is ignored on purpose
  }
  if (typeof cp !== "number" || !Number.isFinite(cp)) return bad("malformed:eval_cp");
  if (mate != null) return bad("malformed:inconsistent");
  if (k === "material_proxy") return bound != null ? bad("malformed:proxy_bound") : { ok: true, score: { kind: "proxy", cp, mate: null, ...ident } };
  return { ok: true, score: { kind: "cp", cp, mate: null, ...ident } };
}

const hollowOf = (s) => (s.kind === "cp" || s.kind === "mate") && (s.bound === "lowerbound" || s.bound === "upperbound" || s.bound === "unknown");
const clippedOf = (s) => (s.kind === "cp" || s.kind === "proxy") && Math.abs(s.cp) > SKY.CLIP_PAWNS * 100;
const pawns = (cp) => {                                            // sign-symmetric rounding; a nonzero cp that rounds to 0.0 keeps its sign
  if (cp === 0) return "0.0";
  const v = Math.sign(cp) * Math.round(Math.abs(cp) / 10) / 10;
  return (cp > 0 ? "+" : "-") + Math.abs(v).toFixed(1);
};
const BOUND_TAG = { lowerbound: " LB", upperbound: " UB", unknown: " bound?" };

export function scoreLabel(s) {
  if (s.kind === "none") return "no score";
  if (s.kind === "mate") return (s.mate > 0 ? "+M" : "-M") + Math.abs(s.mate) + (BOUND_TAG[s.bound] || "");
  if (s.kind === "proxy") return pawns(s.cp) + " mat";
  return pawns(s.cp) + (BOUND_TAG[s.bound] || "") + (clippedOf(s) ? " clip" : "");
}

/** Columns above each board origin; footprint is a square of half-size SKY.HALF centred on the origin (board is +-4). */
export function skylineLayout(layout, boardCount) {
  if (!layout || !Array.isArray(layout.origins)) fail("layout must come from gridLayout()", TypeError);
  if (!isInt(boardCount) || boardCount < 1 || boardCount > 64) fail("boardCount must be an integer from 1 to 64");
  if (boardCount > layout.origins.length) fail("boardCount exceeds layout boards");
  const columns = layout.origins.slice(0, boardCount).map((o, index) => {
    if (!Array.isArray(o) || o.length !== 3 || !o.every(Number.isFinite)) fail("layout origin " + index + " is invalid", TypeError);
    return { index, origin: [...o], center: [o[0], o[2]],
      footprint: { xmin: o[0] - SKY.HALF, xmax: o[0] + SKY.HALF, zmin: o[2] - SKY.HALF, zmax: o[2] + SKY.HALF },
      labelPos: [o[0], SKY.BASE_Y + MAX_H + SKY.LABEL_PAD, o[2]] };
  });
  return { boards: boardCount, baseY: SKY.BASE_Y, maxH: MAX_H, half: SKY.HALF, columns };
}

export function skylineState(sl) {
  if (!sl || !Array.isArray(sl.columns)) fail("skylineState needs a skylineLayout() result", TypeError);
  return { sl, revision: 0, slots: sl.columns.map(() => ({ score: NONE, generation: -1, seq: -1 })) };
}

export function skylineUpdate(state, boardIndex, scoreRecord, generation, seq) {
  const no = (reason) => ({ accepted: false, reason, revision: state.revision });
  if (!isInt(boardIndex) || boardIndex < 0 || boardIndex >= state.slots.length) return no("bad_index");
  if (!isInt(generation) || generation < 0 || !isInt(seq) || seq < 0) return no("bad_counter");
  const slot = state.slots[boardIndex];
  if (generation < slot.generation) return no("stale_generation");
  if (generation === slot.generation && seq <= slot.seq) return no("stale_seq");
  const n = normalizeScore(scoreRecord);
  if (!n.ok) return no(n.reason);                                   // validation precedes advancing the guards
  slot.generation = generation; slot.seq = seq; slot.score = n.score;
  return { accepted: true, reason: "ok", revision: ++state.revision };
}

export function skylineReset(state, { guards = false } = {}) {
  for (const s of state.slots) { s.score = NONE; if (guards) { s.generation = -1; s.seq = -1; } }
  state.revision++;
}

// ---- colours -------------------------------------------------------------------------------------------------
const C = Object.freeze({
  W: [0.1, 0.9, 1], B: [1, 0.2, 0.8], PW: [0.6, 0.9, 0.35], PB: [0.95, 0.6, 0.25], EVEN: [0.8, 0.85, 0.9],
  CLIP: [1, 0.6, 0.1], MATE_W: [1, 1, 0.85], MATE_B: [0.6, 0.3, 1], NONE: [0.6, 0.6, 0.65],
});
const tintOf = (s) => {
  if (s.kind === "mate") return s.mate > 0 ? C.W : C.B;
  const v = s.cp;
  if (s.kind === "proxy") return v > 0 ? C.PW : v < 0 ? C.PB : C.EVEN;
  return v > 0 ? C.W : v < 0 ? C.B : C.EVEN;
};
const capOf = (s) => (s.kind === "mate" ? (s.mate > 0 ? C.MATE_W : C.MATE_B) : clippedOf(s) ? C.CLIP : tintOf(s));
const rgba = (c, a) => [c[0], c[1], c[2], a];
const A = Object.freeze({ capSolid: 0.85, sideSolid: 0.55, hollow: 0.1, hollowCap: 0.14, none: 0.45 });

function column(slot, col, base) {
  const s = slot.score, [cx, cz] = col.center;
  let half = SKY.HALF, y0, y1;
  if (s.kind === "none") { half = SKY.NULL_HALF; y0 = base - SKY.NULL_H; y1 = base + SKY.NULL_H; }
  else {
    const h = s.kind === "mate" ? Math.sign(s.mate) * MAX_H : skylineHeight(s.cp);
    const t = Math.abs(h) < SKY.MIN_H ? (h < 0 ? -SKY.MIN_H : SKY.MIN_H) : h;   // exact zero: hairline slab upward; tiny negative keeps its downward sign
    y0 = base; y1 = base + t;
  }
  const ring = (y) => [[-half, -half], [half, -half], [half, half], [-half, half]].flatMap(([dx, dz]) => [cx + dx, y, cz + dz]);
  return { pts: [...ring(y0), ...ring(y1)] };
}

export function skylinePoints(state) {
  const points = [], colors = [], outlineColors = [], labels = [], details = [];
  state.sl.columns.forEach((col, i) => {
    const slot = state.slots[i], s = slot.score, hollow = hollowOf(s), clipped = clippedOf(s);
    points.push(...column(slot, col, state.sl.baseY).pts);
    const tint = tintOf(s), cap = capOf(s);
    if (s.kind === "none") {
      colors.push(...rgba(C.NONE, A.none), ...[0, 1, 2, 3].flatMap(() => rgba(C.NONE, A.none)));
      outlineColors.push(...[0, 1, 2, 3, 4, 5].flatMap(() => rgba(C.NONE, 0.9)));
    } else if (hollow) {
      colors.push(...rgba(cap, A.hollowCap), ...[0, 1, 2, 3].flatMap(() => rgba(tint, A.hollow)));
      outlineColors.push(...rgba(tint, 1), ...rgba(cap, 1), ...[0, 1, 2, 3].flatMap(() => rgba(tint, 1)));
    } else {
      colors.push(...rgba(cap, A.capSolid), ...[0, 1, 2, 3].flatMap(() => rgba(tint, A.sideSolid)));
      outlineColors.push(...[0, 1, 2, 3, 4, 5].flatMap(() => [0, 0, 0, 0]));
    }
    const label = scoreLabel(s);
    labels.push(label);
    details.push({ index: i, kind: s.kind, cp: s.cp, mate: s.mate, bound: s.bound, hollow, clipped, label,
      fen: s.fen, ply: s.ply, generation: slot.generation, seq: slot.seq });
  });
  return { points, colors, outlineColors, labels, details, revision: state.revision };
}

export function groupFlat(flat, k) {
  const out = [];
  for (let i = 0; i < flat.length; i += k) out.push(flat.slice(i, i + k));
  return out;
}

// ---- XML -----------------------------------------------------------------------------------------------------
const safeDef = (def) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(def)) fail("def must be an X3D-safe name", TypeError); return def; };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function skylineXml(layout, n, { def = "skyline" } = {}) {
  safeDef(def);
  const sl = skylineLayout(layout, n), st = skylineState(sl), u = skylinePoints(st);
  const pts = groupFlat(u.points, 3).map((p) => p.join(" ")).join(", ");
  const fidx = [], lidx = [];
  for (let c = 0; c < n; c++) {
    const a = c * 8, b = a + 4;
    fidx.push(`${b} ${b + 1} ${b + 2} ${b + 3} -1`);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; fidx.push(`${a + k} ${a + j} ${b + j} ${b + k} -1`); }
    lidx.push(`${a} ${a + 1} ${a + 2} ${a + 3} ${a} -1`, `${b} ${b + 1} ${b + 2} ${b + 3} ${b} -1`);
    for (let k = 0; k < 4; k++) lidx.push(`${a + k} ${b + k} -1`);
  }
  const rgbaList = (flat) => groupFlat(flat, 4).map((c) => c.join(" ")).join(", ");
  const texts = sl.columns.map((col) => `<Transform translation='${col.labelPos.join(" ")}'><Shape pointerEvents='false'><Appearance><Material diffuseColor='0 0 0' emissiveColor='0.85 0.9 0.95'/></Appearance><Text DEF='${def}_text${col.index}' string='"${esc(u.labels[col.index])}"'><FontStyle size='0.55' justify='"MIDDLE" "MIDDLE"'/></Text></Shape></Transform>`);
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='4'/><component name='Text' level='1'/><meta name='title' content='x3d.chess tournament skyline'/></head><Scene><Group DEF='${def}' visible='false'>
<Shape pointerEvents='false' DEF='${def}_fill'><Appearance/><IndexedFaceSet coordIndex='${fidx.join(" ")}' colorPerVertex='false' solid='false'><Coordinate DEF='${def}_coord' point='${pts}'/><ColorRGBA DEF='${def}_color' color='${rgbaList(u.colors)}'/></IndexedFaceSet></Shape>
<Shape pointerEvents='false' DEF='${def}_outline'><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 1 1'/></Appearance><IndexedLineSet coordIndex='${lidx.join(" ")}' colorPerVertex='false'><Coordinate DEF='${def}_ocoord' point='${pts}'/><ColorRGBA DEF='${def}_ocolor' color='${rgbaList(u.outlineColors)}'/></IndexedLineSet></Shape>
${texts.join("\n")}
</Group></Scene></X3D>`;
}

// ---- eval history ribbon ---------------------------------------------------------------------------------------
const MATE_BAR_H = SKY.CLIP_PAWNS * SKY.RIB_K;

export function ribbonPoints(history, origin) {
  if (!Array.isArray(history)) fail("history must be an array", TypeError);
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) fail("origin must be three finite numbers", TypeError);
  const L = SKY.RIB_LEN, start = Math.max(0, history.length - L), win = history.slice(start);
  const x0 = origin[0] - SKY.RIB_WIDTH / 2, z = origin[2] - SKY.RIB_BACK, base = SKY.RIB_BASE_Y, step = SKY.RIB_WIDTH / (L - 1);
  const xs = (i) => x0 + i * step;
  const samples = win.map((h) => { const n = normalizeScore(h); return n.ok ? n.score : NONE; });
  const points = [], coordIndex = [], colors = [], faces = [], runs = [], gaps = [], mates = [];
  const quad = (pl, col, a, face) => { const i = points.length; points.push(...pl); coordIndex.push(...pl.map((_, k) => i + k), -1); colors.push(...rgba(col, a)); faces.push(face); };
  const y = (cp) => base + clamp(cp / 100, -SKY.CLIP_PAWNS, SKY.CLIP_PAWNS) * SKY.RIB_K;
  const wallCol = (s, v) => (clippedOf(s) ? C.CLIP : (s.kind === "proxy" ? (v >= 0 ? C.PW : C.PB) : (v >= 0 ? C.W : C.B)));
  const alpha = (...ss) => (ss.some(hollowOf) ? 0.18 : 0.6);
  const drawn = (s) => s.kind === "cp" || s.kind === "proxy";
  let runStart = null;
  samples.forEach((s, i) => {
    if (s.kind === "none") gaps.push(i);
    if (s.kind === "mate") mates.push(i);
    const next = samples[i + 1], joined = drawn(s) && next && drawn(next) && next.kind === s.kind;
    if (drawn(s) && runStart === null) runStart = i;
    if (!joined && runStart !== null) { runs.push([runStart, i]); runStart = null; }
  });
  samples.forEach((s, i) => {
    const x = xs(i);
    if (s.kind === "mate") {                                       // separate typed marker, never connected
      const sg = Math.sign(s.mate), w = step * 0.3, c = s.mate > 0 ? C.MATE_W : C.MATE_B;
      quad([[x - w, base, z], [x + w, base, z], [x + w, base + sg * MATE_BAR_H, z], [x - w, base + sg * MATE_BAR_H, z]], c, hollowOf(s) ? 0.3 : 0.9, { type: "mate", slot: i });
      return;
    }
    if (!drawn(s)) return;
    const next = samples[i + 1], joined = next && drawn(next) && next.kind === s.kind;
    if (!joined) {
      if (i === 0 || !(drawn(samples[i - 1]) && samples[i - 1].kind === s.kind)) {      // isolated sample: a thin tick, not a line
        const w = step * 0.15, yy = s.cp === 0 ? base + SKY.RIB_HAIR : y(s.cp);   // exact 0 is a hairline, never invisible
        quad([[x - w, base, z], [x + w, base, z], [x + w, yy, z], [x - w, yy, z]], wallCol(s, s.cp), alpha(s), { type: "tick", slot: i });
      }
      return;
    }
    const xb = xs(i + 1), y0 = y(s.cp), y1 = y(next.cp), d0 = y0 - base, d1 = y1 - base, a = alpha(s, next);
    if (s.cp === 0 && next.cp === 0) {                              // flat zero run: hairline strip so a reported 0 is not mistaken for a gap
      quad([[x, base, z], [xb, base, z], [xb, base + SKY.RIB_HAIR, z], [x, base + SKY.RIB_HAIR, z]], wallCol(s, 0), a, { type: "segment", slots: [i, i + 1], part: 0 });
      return;
    }
    if (d0 * d1 < 0) {                                              // sign change: split at the zero crossing (no bow-tie)
      const xc = x + step * (d0 / (d0 - d1));
      quad([[x, base, z], [xc, base, z], [x, y0, z]], wallCol(s, d0), a, { type: "segment", slots: [i, i + 1], part: 0 });
      quad([[xc, base, z], [xb, base, z], [xb, y1, z]], wallCol(s, d1), a, { type: "segment", slots: [i, i + 1], part: 1 });
    } else {
      const v = d0 + d1;
      quad([[x, base, z], [xb, base, z], [xb, y1, z], [x, y0, z]], wallCol(s, v), a, { type: "segment", slots: [i, i + 1], part: 0 });
    }
  });
  return { points: points.flat(), coordIndex, colors, faces, runs, gaps, mates,
    window: { start, end: history.length, length: win.length }, x0, z, base };
}

export function ribbonXml(origin, { def = "ribbon" } = {}) {
  safeDef(def);
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) fail("origin must be three finite numbers", TypeError);
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='4'/></head><Scene><Shape pointerEvents='false' DEF='${def}'><Appearance/>
<IndexedFaceSet coordIndex='' colorPerVertex='false' solid='false'><Coordinate DEF='${def}_coord' point=''/><ColorRGBA DEF='${def}_color' color=''/></IndexedFaceSet></Shape></Scene></X3D>`;
}
