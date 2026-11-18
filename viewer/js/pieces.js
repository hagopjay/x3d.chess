// Native X3D primitive pieces; callers can pin a palette per board/build.
import { THEMES } from "./themes.js";
let th = THEMES.neon;
export const setPieceTheme = (t) => { th = t; };
const shape = (geo, y, c, t) =>
  `<Transform translation='0 ${y} 0'><Shape pointerEvents='false'><Appearance><Material diffuseColor='${t[c].c}' emissiveColor='${t[c].e}' specularColor='0.4 0.4 0.4' shininess='0.5'/></Appearance>${geo}</Shape></Transform>`;
const cyl = (r, h) => `<Cylinder radius='${r}' height='${h}'/>`;
const cone = (r, h) => `<Cone bottomRadius='${r}' height='${h}'/>`;
const sph = (r) => `<Sphere radius='${r}'/>`;
const box = (x, y, z) => `<Box size='${x} ${y} ${z}'/>`;
const BODY = {
  p: [[cyl(0.26,0.12),0.06],[cone(0.2,0.42),0.33],[sph(0.14),0.58]],
  r: [[cyl(0.3,0.12),0.06],[cyl(0.22,0.5),0.37],[box(0.46,0.14,0.46),0.68]],
  n: [[cyl(0.3,0.12),0.06],[cone(0.24,0.55),0.4],[box(0.2,0.22,0.4),0.72]],
  b: [[cyl(0.3,0.12),0.06],[cone(0.24,0.7),0.46],[sph(0.16),0.86]],
  q: [[cyl(0.32,0.12),0.06],[cone(0.28,0.9),0.57],[sph(0.2),1.12],[cyl(0.12,0.08),1.34]],
  k: [[cyl(0.32,0.12),0.06],[cone(0.28,0.95),0.6],[box(0.1,0.34,0.1),1.25],[box(0.3,0.1,0.1),1.25]],
};

/** Optional explicit theme prevents another scene's global palette changing this build. */
export function pieceXml(type, color, theme = th) {
  if (!Object.hasOwn(BODY,type) || !["w","b"].includes(color)) throw new RangeError("Unknown chess piece");
  return `<Transform>${BODY[type].map(([geo,y])=>shape(geo,y,color,theme)).join("")}</Transform>`;
}
