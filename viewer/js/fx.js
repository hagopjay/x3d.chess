// Per-board effects: last-move highlight and tactic lines. Pure X3D nodes created at runtime.
import { sqPos, validSquare } from "./board.js";

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
  if (typeof uci === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) xml += hl(uci.slice(0, 2), origin, "1 0.9 0.2") + hl(uci.slice(2, 4), origin, extra.captured ? "1 0.35 0.1" : "1 0.9 0.2");
  if (validSquare(extra.checkSq)) xml += hl(extra.checkSq, origin, "1 0 0.15");
  for (const t of (Array.isArray(tactics) ? tactics : []).slice(0, 3)) {
    if (validSquare(t.piece_square) && Array.isArray(t.target_squares)) xml += line(t.piece_square, t.target_squares.filter(validSquare).slice(0, 8), origin, t.severity);
  }
  return `<Group>${xml}</Group>`;
}

const rgb = (input, fallback) => {
  const values = input == null ? fallback : Array.isArray(input) ? input : typeof input === "string" ? input.trim().split(/\s+/).map(Number) : [];
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("Study colors need three finite values in [0,1]");
  return values.join(" ");
};

/** Synthetic relation overlays: these arcs describe a relation, not a move animation. */
export function studyFxXml(data = {}, origin) {
  const squares = data.squares || [], lines = data.lines || [];
  if (!Array.isArray(squares) || squares.length > 64 || !Array.isArray(lines) || lines.length > 128) throw new Error("Study overlay budget exceeded");
  let xml = "";
  for (const item of squares) {
    const square = typeof item === "string" ? item : item.square;
    if (!validSquare(square)) throw new Error("Invalid study square");
    xml += hl(square, origin, rgb(item.color, [0.25, 0.95, 0.65]));
  }
  for (const item of lines) {
    if (!validSquare(item.from) || !validSquare(item.to)) throw new Error("Invalid study relation square");
    const [x, , z] = sqPos(item.from, origin), [u, , v] = sqPos(item.to, origin), color = rgb(item.color, [0.95, 0.65, 0.25]);
    xml += `<Shape pointerEvents='false'><Appearance><Material diffuseColor='0 0 0' emissiveColor='${color}'/></Appearance><IndexedLineSet coordIndex='0 1 2 -1'><Coordinate point='${x} 1.45 ${z}, ${(x + u) / 2} 2.35 ${(z + v) / 2}, ${u} 1.45 ${v}'/></IndexedLineSet></Shape>`;
  }
  return `<Group>${xml}</Group>`;
}
