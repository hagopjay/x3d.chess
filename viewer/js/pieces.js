// Piece geometry as X3D XML (primitives only; glb/Inline pieces can replace these later).
// Each factory returns a <Transform> string; the caller sets translation through SAI.
const COL = { w: "0.95 0.95 0.9", b: "0.15 0.12 0.2" };
const EMI = { w: "0.12 0.4 0.5", b: "0.45 0.05 0.35" };   // neon rim: cyan vs magenta (original palette)

const shape = (geo, y, c) =>
  `<Transform translation='0 ${y} 0'><Shape><Appearance><Material diffuseColor='${COL[c]}' emissiveColor='${EMI[c]}' specularColor='0.4 0.4 0.4' shininess='0.5'/></Appearance>${geo}</Shape></Transform>`;
const cyl = (r, h) => `<Cylinder radius='${r}' height='${h}'/>`;
const cone = (r, h) => `<Cone bottomRadius='${r}' height='${h}'/>`;
const sph = (r) => `<Sphere radius='${r}'/>`;
const box = (x, y, z) => `<Box size='${x} ${y} ${z}'/>`;

const BODY = {
  p: (c) => shape(cyl(0.26, 0.12), 0.06, c) + shape(cone(0.2, 0.42), 0.33, c) + shape(sph(0.14), 0.58, c),
  r: (c) => shape(cyl(0.3, 0.12), 0.06, c) + shape(cyl(0.22, 0.5), 0.37, c) + shape(box(0.46, 0.14, 0.46), 0.68, c),
  n: (c) => shape(cyl(0.3, 0.12), 0.06, c) + shape(cone(0.24, 0.55), 0.4, c) + shape(box(0.2, 0.22, 0.4), 0.72, c),
  b: (c) => shape(cyl(0.3, 0.12), 0.06, c) + shape(cone(0.24, 0.7), 0.46, c) + shape(sph(0.16), 0.86, c),
  q: (c) => shape(cyl(0.32, 0.12), 0.06, c) + shape(cone(0.28, 0.9), 0.57, c) + shape(sph(0.2), 1.12, c) + shape(cyl(0.12, 0.08), 1.34, c),
  k: (c) => shape(cyl(0.32, 0.12), 0.06, c) + shape(cone(0.28, 0.95), 0.6, c) + shape(box(0.1, 0.34, 0.1), 1.25, c) + shape(box(0.3, 0.1, 0.1), 1.25, c),
};

/** @param {string} type one of p n b r q k  @param {string} color w|b */
export function pieceXml(type, color) {
  return `<Transform>${BODY[type](color)}</Transform>`;
}
