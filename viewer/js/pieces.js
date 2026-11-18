// Authored X3D tournament pieces. Smooth turned profiles keep a readable
// silhouette at overview scale; crowns and the knight remain distinct in focus.
// Geometry is bounded (16 radial sides), local, and shared by live/export paths.
import { THEMES } from "./themes.js";
let th = THEMES.neon;
export const setPieceTheme = (t) => { th = t; };
const fmt = n => String(Number(n.toFixed(5)));
const shape = (geo, c, t) => `<Shape pointerEvents='false'><Appearance><Material diffuseColor='${t[c].c}' emissiveColor='${t[c].e}' specularColor='${c === "w" ? "0.52 0.5 0.43" : "0.38 0.45 0.42"}' shininess='0.38'/></Appearance>${geo}</Shape>`;
const at = (geo, y, x = 0, z = 0, rotation = "") => `<Transform translation='${fmt(x)} ${fmt(y)} ${fmt(z)}'${rotation ? ` rotation='${rotation}'` : ""}>${geo}</Transform>`;
const sph = r => `<Sphere radius='${r}'/>`;
const box = (x, y, z) => `<Box size='${x} ${y} ${z}'/>`;

/** Closed surface of revolution. Positive-radius rings avoid collapsed quads. */
function turned(profile) {
  const sides = 16, points = [], faces = [];
  for (const [r, y] of profile) for (let i = 0; i < sides; i++) {
    const a = i / sides * Math.PI * 2;
    points.push(`${fmt(Math.cos(a) * r)} ${y} ${fmt(Math.sin(a) * r)}`);
  }
  for (let row = 0; row < profile.length - 1; row++) for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, a = row * sides, b = a + sides;
    faces.push(`${a + i} ${b + i} ${b + j} ${a + j} -1`);
  }
  // Ring vertices run clockwise when seen from +Y.
  faces.push(Array.from({ length: sides }, (_, i) => i).join(" ") + " -1");
  const end = (profile.length - 1) * sides;
  faces.push(Array.from({ length: sides }, (_, i) => end + sides - 1 - i).join(" ") + " -1");
  return `<IndexedFaceSet creaseAngle='0.6' coordIndex='${faces.join(" ")}'><Coordinate point='${points.join(",")}'/></IndexedFaceSet>`;
}

const foot = (r = 0.3) => [[r * .80, 0], [r * .96, .025], [r, .065], [r * .96, .095], [r * .82, .13], [r * .78, .17]];
const profiles = {
  p: [...foot(.265), [.15,.20],[.105,.36],[.12,.41],[.16,.435],[.16,.47],[.10,.49]],
  r: [...foot(.31), [.20,.21],[.175,.28],[.175,.56],[.22,.59],[.27,.61],[.27,.67],[.235,.70]],
  n: [...foot(.30), [.21,.205],[.21,.245],[.17,.27]],
  b: [...foot(.30), [.19,.215],[.11,.50],[.12,.61],[.205,.65],[.205,.69],[.12,.73]],
  q: [...foot(.325), [.21,.22],[.12,.60],[.14,.75],[.24,.79],[.24,.835],[.17,.87],[.25,1.055],[.255,1.10],[.19,1.13]],
  k: [...foot(.33), [.22,.22],[.13,.63],[.15,.78],[.25,.815],[.25,.86],[.16,.90],[.15,1.08],[.20,1.10],[.20,1.15]],
};

// Horse-head outline extruded in X: snout, neck and ear read at oblique poses.
const horseProfile = [[.19,.23],[.20,.43],[.13,.68],[.015,.86],[-.005,1.015],[-.115,.94],[-.155,.84],[-.31,.735],[-.34,.64],[-.23,.60],[-.075,.65],[-.07,.425],[-.19,.23]];
function knightHead() {
  const n = horseProfile.length, points = [-.11,.11].flatMap(x => horseProfile.map(([z,y]) => `${x} ${y} ${z}`));
  const faces = [Array.from({length:n},(_,i)=>i).join(" ")+" -1",Array.from({length:n},(_,i)=>2*n-1-i).join(" ")+" -1"];
  for(let i=0;i<n;i++){const j=(i+1)%n;faces.push(`${i} ${i+n} ${j+n} ${j} -1`);}
  return `<IndexedFaceSet convex='false' creaseAngle='0.42' coordIndex='${faces.join(" ")}'><Coordinate point='${points.join(",")}'/></IndexedFaceSet>`;
}

// Cache geometry strings, not scene nodes: appearance/lifetime stay independent.
const bodies = Object.fromEntries(Object.entries(profiles).map(([t,p]) => [t,turned(p)]));
const horse = knightHead();

/** Optional explicit palette prevents another scene changing this build. */
export function pieceXml(type, color, theme = th) {
  if (!Object.hasOwn(bodies,type) || !["w","b"].includes(color)) throw new RangeError("Unknown chess piece");
  const s = geo => shape(geo,color,theme);
  let detail = "";
  if(type === "p") detail = at(s(sph(.135)),.58);
  if(type === "r") detail = Array.from({length:4},(_,i)=>{const a=i*Math.PI/2;return at(s(box(.14,.13,.15)),.73,Math.sin(a)*.195,Math.cos(a)*.195,`0 1 0 ${fmt(a)}`);}).join("");
  if(type === "n") detail = s(horse);
  if(type === "b") {
    // Two tilted lobes leave a real mitre slit; no painted rule/analysis cue.
    const lobe = turned([[.06,0],[.09,.08],[.075,.18],[.015,.28]]);
    detail = at(s(lobe),.72,-.065,0,"0 0 1 0.14") + at(s(lobe),.72,.065,0,"0 0 1 -0.14");
  }
  if(type === "q") detail = Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5;return at(s(sph(.05)),1.155,Math.cos(a)*.205,Math.sin(a)*.205);}).join("") + at(s(sph(.075)),1.19);
  if(type === "k") detail = at(s(box(.095,.31,.095)),1.30) + at(s(box(.29,.09,.095)),1.335);
  return `<Transform${color === "b" && type === "n" ? " rotation='0 1 0 3.141592653589793'" : ""}>${s(bodies[type])}${detail}</Transform>`;
}
