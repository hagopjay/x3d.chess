// Per-board effects: last-move highlight and tactic lines. Pure X3D nodes created at runtime.
import { sqPos } from "./board.js";

const SEV = { winning: "1 0.2 0.6", material: "1 0.7 0.1", positional: "0.4 0.8 1" };

const hl = (sq, o, color) => {
  const [x, , z] = sqPos(sq, o);
  return `<Transform translation='${x} 0.08 ${z}'><Shape pointerEvents='false'><Appearance><Material diffuseColor='${color}' emissiveColor='${color}' transparency='0.55'/></Appearance><Box size='0.96 0.02 0.96'/></Shape></Transform>`;
};

const line = (from, tos, o, sev) => {
  const [fx, , fz] = sqPos(from, o);
  const pts = [`${fx} 1.4 ${fz}`], idx = [];
  tos.forEach((t, i) => { const [x, , z] = sqPos(t, o); pts.push(`${x} 1.0 ${z}`); idx.push(`0 ${i + 1} -1`); });
  const c = SEV[sev] || SEV.material;
  return `<Shape pointerEvents='false'><Appearance><Material emissiveColor='${c}' diffuseColor='${c}'/></Appearance><IndexedLineSet coordIndex='${idx.join(" ")}'><Coordinate point='${pts.join(", ")}'/></IndexedLineSet></Shape>`;
};

/** Returns an XML <Group> string for a move: from/to squares plus up to 3 tactic lines. */
export function moveFxXml(uci, tactics, origin, extra = {}) {
  let xml = "";
  if (uci) xml += hl(uci.slice(0, 2), origin, "1 0.9 0.2") + hl(uci.slice(2, 4), origin, extra.captured ? "1 0.35 0.1" : "1 0.9 0.2");
  if (extra.checkSq) xml += hl(extra.checkSq, origin, "1 0 0.15");
  for (const t of (tactics || []).slice(0, 3)) xml += line(t.piece_square, t.target_squares, origin, t.severity);
  return `<Group>${xml}</Group>`;
}
