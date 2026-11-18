// 3D EVALUATION TERRAIN: one relief per board, one square = one column.
//
// What it shows (and only this): a per-square static attack-count balance, i.e.
// (# white pieces that geometrically attack the square) - (# black pieces ...), from
// controlGrid() in analysis.js. Column HEIGHT = |balance| (capped), COLOUR = sign
// (cyan: white attackers outnumber black, magenta: black outnumber white; same
// palette as the heat overlay). It is NOT legal mobility, NOT an engine evaluation,
// NOT a prediction of exchanges. Pinned pieces still count as attackers (geometric).
//
// Optional mode 'material' (material-weighted pressure): same geometry, but each attacker
// contributes its nominal value (P1 N3 B3 R5 Q9, king 0) and the column shows
// (sum white attacker values) - (sum black attacker values). It is a static sum, not
// SEE and not exchange value: a bigger value on the attacking side is NOT a better capture.
//
// PUBLIC API
//   TERRAIN_MODES      {count:{...}, material:{...}}  (unit, cap, label, formula)
//   LEGEND             honest labels (strings) for UI text
//   terrainXml(origin, {def='terrain'})  -> full X3D 4.0 Interchange doc string with ONE
//        Shape(pointerEvents=false, visible=false) / IndexedFaceSet of 64 columns x 5 faces
//        (top + 4 sides); Coordinate DEF=<def>_coord, ColorRGBA DEF=<def>_color. Created once.
//   terrainGrid(fen, mode='count') -> 64 ints (a1=0..h8=63, same index as controlGrid)
//   terrainFromGrid(grid, origin, mode='count') -> {mode, grid, heights[64], clipped[64],
//        colors[320] (RGBA per FACE; column c owns faces 5c..5c+4: top, then 4 sides),
//        points[1536] (flat xyz of 512 vertices; only the 256 top-vertex y's differ by grid),
//        legend}
//   terrainUpdate(fen, origin=[0,0,0], mode='count') -> terrainFromGrid(terrainGrid(fen),...)
//   terrainPoints(grid, origin, mode) -> flat number[1536] for Coordinate.point
//   terrainColors(grid, mode) -> flat number[1280] for ColorRGBA.color
//   Invalid input (grid length != 64, non-integer/NaN entries, bad origin/mode) throws RangeError/TypeError.
//
// INTEGRATION (lead adds; this file touches nothing shared)
//   - Once per board at scene build (next to heatXml): 
//       const n = (await browser.createX3DFromString(terrainXml(origin, {def:'terrain'+i}))).rootNodes[0];
//       browser.currentScene.addRootNode(n); keep n (Shape) and n.geometry.coord / n.geometry.color.
//   - Toggle: button/key 'T' sets n.visible = !n.visible (fields: Shape.visible). Keep pointerEvents false
//     so the board TouchSensor still picks.
//   - On each accepted snapshot/move (only if visible): const u = terrainUpdate(fen, origin, mode);
//       n.geometry.coord.point = u.points as MFVec3f (group the flat list in 3s if X_ITE wants SFVec3f
//       objects: new X3DConstants SFVec3f / plain arrays per runtime); n.geometry.color.color = u.colors
//       grouped in 4s. Both writes must use the SAME fen/ply.
//   - Revision guard: capture `rev = ++terrainRev` before any await; apply only if rev === terrainRev and
//     generation unchanged (same pattern as heat/graph). On reset / new generation / dispose: bump the rev,
//     set colors to all '0 0 0 0' (use terrainColors(new Array(64).fill(0))) and visible=false.
//   - Show LEGEND.* strings next to the toggle (height/colour/clip/mode labels).
import { Chess } from "../vendor/chess.js";
import { controlGrid, sqName } from "./analysis.js";

const BASE_Y = 0.07, INSET = 0.05, SIDE_SHADE = 0.7, ALPHA = 0.85;
const POS = [0.1, 0.9, 1], NEG = [1, 0.2, 0.8], CLIP_CAP = [1, 0.85, 0.2, 1];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const TERRAIN_MODES = Object.freeze({
  count: Object.freeze({ unit: 0.1, cap: 6, label: "attack-count balance",
    formula: "height = min(|white attackers - black attackers|, 6) x 0.1" }),
  material: Object.freeze({ unit: 0.05, cap: 12, label: "material-weighted pressure",
    formula: "height = min(|sum white attacker values - sum black attacker values|, 12) x 0.05; P1 N3 B3 R5 Q9, K0" }),
});

export const LEGEND = Object.freeze({
  title: "Terrain: static attack pressure per square",
  count: "Height = |white attackers - black attackers| on that square (geometric attack count; not legal mobility, not an engine eval).",
  material: "Height = |sum of white attacker values - sum of black attacker values| (static sum, kings 0; not SEE, not exchange value).",
  color: "Cyan = white attackers outnumber black; magenta = black outnumber white; invisible = zero net balance (equal counts or equal values; in material mode a square attacked only by kings also reads as zero).",
  clip: "Gold cap = value exceeds the display cap and the column is truncated; true height is larger.",
  pins: "Pinned pieces still count as attackers (attack is geometric, not legal-move based).",
  limits: "Static position only: ignores whose turn it is, pins on moves, x-ray recaptures and tactics.",
});

const fail = (m, E = RangeError) => { throw new E(m); };
function checkOrigin(o) {
  if (!Array.isArray(o) || o.length !== 3 || !o.every(Number.isFinite)) fail("origin must be 3 finite numbers", TypeError);
}
function checkMode(m) { if (!Object.hasOwn(TERRAIN_MODES, m)) fail("unknown terrain mode: " + m); }
function checkGrid(g) {
  if (!Array.isArray(g) || g.length !== 64) fail("grid must be an array of exactly 64 entries");
  for (let i = 0; i < 64; i++) if (!Number.isInteger(g[i])) fail("grid[" + i + "] must be a finite integer");
}

/** Square index (a1=0) -> footprint corners. rank 1 at +z, files along +x (same as heatXml). */
function footprint(sq, o) {
  const f = sq % 8, r = Math.floor(sq / 8);
  const x = o[0] + f - 4, z = o[2] + 3 - r;
  const x0 = x + INSET, x1 = x + 1 - INSET, z0 = z + INSET, z1 = z + 1 - INSET;
  return [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];   // CCW seen from +y (same order as heat quads)
}

export function terrainGrid(fen, mode = "count") {
  checkMode(mode);
  const chess = new Chess(fen);
  if (mode === "count") return controlGrid(chess);
  return Array.from({ length: 64 }, (_, sq) => {
    const name = sqName(sq);
    let s = 0;
    for (const c of ["w", "b"]) for (const a of chess.attackers(name, c)) s += (c === "w" ? 1 : -1) * VALUE[chess.get(a).type];
    return s;
  });
}

function heightOf(n, mode) {
  const m = TERRAIN_MODES[mode];
  return Math.min(Math.abs(n), m.cap) * m.unit;
}

/** Flat xyz of 512 vertices: column c -> vertices 8c..8c+3 bottom, 8c+4..8c+7 top. */
export function terrainPoints(grid, origin, mode = "count") {
  checkGrid(grid); checkOrigin(origin); checkMode(mode);
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const fp = footprint(sq, origin), h = heightOf(grid[sq], mode);
    for (const [x, z] of fp) out.push(x, BASE_Y, z);
    for (const [x, z] of fp) out.push(x, BASE_Y + h, z);
  }
  return out;
}

/** Flat RGBA, one per face: 5 faces per column (top, then sides). Zero balance -> alpha 0. */
export function terrainColors(grid, mode = "count") {
  checkGrid(grid); checkMode(mode);
  const cap = TERRAIN_MODES[mode].cap, out = [];
  for (let sq = 0; sq < 64; sq++) {
    const n = grid[sq];
    if (!n) { for (let k = 0; k < 5; k++) out.push(0, 0, 0, 0); continue; }
    const base = n > 0 ? POS : NEG;
    out.push(...(Math.abs(n) > cap ? CLIP_CAP : [...base, ALPHA]));
    for (let k = 0; k < 4; k++) out.push(base[0] * SIDE_SHADE, base[1] * SIDE_SHADE, base[2] * SIDE_SHADE, ALPHA);
  }
  return out;
}

export function terrainFromGrid(grid, origin = [0, 0, 0], mode = "count") {
  checkGrid(grid); checkOrigin(origin); checkMode(mode);
  const cap = TERRAIN_MODES[mode].cap;
  return {
    mode, grid: grid.slice(),
    heights: grid.map((n) => heightOf(n, mode)),
    clipped: grid.map((n) => Math.abs(n) > cap),
    colors: terrainColors(grid, mode),
    points: terrainPoints(grid, origin, mode),
    legend: { title: LEGEND.title, quantity: TERRAIN_MODES[mode].label, formula: TERRAIN_MODES[mode].formula,
      detail: LEGEND[mode], color: LEGEND.color, clip: LEGEND.clip, pins: LEGEND.pins, limits: LEGEND.limits },
  };
}

export function terrainUpdate(fen, origin = [0, 0, 0], mode = "count") {
  return terrainFromGrid(terrainGrid(fen, mode), origin, mode);
}

const group = (a, k) => {
  if (!Array.isArray(a) && !ArrayBuffer.isView(a)) fail("groupFlat: arr must be an array", TypeError);
  if (!Number.isInteger(k) || k < 1) fail("groupFlat: k must be a positive integer");
  if (a.length % k) fail("groupFlat: length " + a.length + " is not a multiple of " + k);
  const r = []; for (let i = 0; i < a.length; i += k) r.push(a.slice(i, i + k)); return r; };
export { group as groupFlat };

/** One shape, created once, initially invisible and flat (all heights 0, all faces transparent). */
export function terrainXml(origin, { def = "terrain" } = {}) {
  checkOrigin(origin);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(def)) fail("def must be an X3D-safe name", TypeError);
  const flat = new Array(64).fill(0);
  const pts = group(terrainPoints(flat, origin), 3).map((p) => p.join(" ")).join(", ");
  const idx = [];
  for (let c = 0; c < 64; c++) {
    const b = c * 8, t = b + 4;
    idx.push(`${t} ${t + 1} ${t + 2} ${t + 3} -1`);                       // top, normal +y
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; idx.push(`${b + k} ${b + j} ${t + j} ${t + k} -1`); }
  }
  const cols = new Array(320).fill("0 0 0 0").join(", ");
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='4'/></head><Scene><Shape pointerEvents='false' visible='false' DEF='${def}'><Appearance/>
    <IndexedFaceSet coordIndex='${idx.join(" ")}' colorPerVertex='false' solid='false'><Coordinate DEF='${def}_coord' point='${pts}'/>
    <ColorRGBA DEF='${def}_color' color='${cols}'/></IndexedFaceSet></Shape></Scene></X3D>`;
}
