// Per-board overlays: pressure heatmap (one IndexedFaceSet, 64 quads coloured per face) and an eval graph
// (one IndexedLineSet along the board's front edge). Both are single shapes per board, updated through SAI.
import { Chess } from "../vendor/chess.js";
import { controlGrid } from "./analysis.js";

const HEAT_Y = 0.065;
const GRAPH_LEN = 60, GRAPH_H = 0.65, GRAPH_RANGE = 6;      // last 60 plies, +-6 pawns maps to +-0.65 units, laid flat in the gap in front of the board

export function heatXml(o) {
  const pts = [], idx = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const x = o[0] + f - 4, z = o[2] + 3 - r, i = pts.length;                // square corners, rank 1 at +z
    pts.push(`${x} ${HEAT_Y} ${z + 1}`, `${x + 1} ${HEAT_Y} ${z + 1}`, `${x + 1} ${HEAT_Y} ${z}`, `${x} ${HEAT_Y} ${z}`);
    idx.push(`${i} ${i + 1} ${i + 2} ${i + 3} -1`);
  }
  // r=0 is rank 1 (bottom, +z): faces are ordered a1..h1, a2..h2 ... = square index order
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='4'/></head><Scene><Shape visible='false' DEF='heat'><Appearance/>
    <IndexedFaceSet coordIndex='${idx.join(" ")}' colorPerVertex='false' solid='false'><Coordinate point='${pts.join(", ")}'/>
    <ColorRGBA color='${new Array(64).fill("0 0 0 0").join(", ")}'/></IndexedFaceSet></Shape></Scene></X3D>`;
}

export function heatColors(fen) {
  const g = controlGrid(new Chess(fen));
  return g.map((n) => {
    const a = Math.min(0.6, 0.14 * Math.abs(n));
    return !n ? [0, 0, 0, 0] : n > 0 ? [0.1, 0.9, 1, a] : [1, 0.2, 0.8, a];
  });
}

export function graphXml(o) {
  const x0 = o[0] - 4, y = 0.06, z = o[2] + 5.0;
  return `<X3D profile='Interchange' version='4.0'><Scene><Group DEF='graph'>
    <Shape><Appearance><Material emissiveColor='0.25 0.3 0.4' diffuseColor='0 0 0'/></Appearance><IndexedLineSet coordIndex='0 1 -1'><Coordinate point='${x0} ${y} ${z}, ${x0 + 8} ${y} ${z}'/></IndexedLineSet></Shape>
    <Shape><Appearance><Material emissiveColor='0.4 1 0.7' diffuseColor='0 0 0'/></Appearance><IndexedLineSet DEF='graphline' coordIndex='-1'><Coordinate DEF='graphc' point='0 0 0'/></IndexedLineSet></Shape>
  </Group></Scene></X3D>`;
}

export function graphPoints(history, o) {
  const x0 = o[0] - 4, y = 0.06, z = o[2] + 5.0, n = history.length;
  return history.map((cp, i) => {
    const p = Math.max(-GRAPH_RANGE, Math.min(GRAPH_RANGE, cp / 100));
    return [x0 + (i / (GRAPH_LEN - 1)) * 8, y, z + (p / GRAPH_RANGE) * GRAPH_H];   // white ahead bends toward +z (the white side, rank 1)
  });
}
export { GRAPH_LEN };
