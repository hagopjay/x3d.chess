// CameraRig: fly-to between poses by driving the bound `vp_focus` viewpoint from the page
// (Viewpoint has no offsets in X_ITE, so we set position/orientation ourselves; TELEPORT transition, see grid.x3d).
const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, t) => a + (b - a) * t;
const quaternion = ([x,y,z,a]) => {
  const d = Math.hypot(x,y,z) || 1, s = Math.sin(a/2)/d;
  return [x*s,y*s,z*s,Math.cos(a/2)];
};
// Axis-angle components cannot be interpolated independently when a camera
// crosses from White's side to Black's. Use the shortest quaternion arc.
function orientationBetween(from,to,t) {
  const a=quaternion(from);let b=quaternion(to),dot=a.reduce((n,v,i)=>n+v*b[i],0);
  if(dot<0){b=b.map(v=>-v);dot=-dot;}
  let q;
  if(dot>.9995)q=a.map((v,i)=>lerp(v,b[i],t));
  else {const angle=Math.acos(Math.min(1,dot)),s=Math.sin(angle);q=a.map((v,i)=>(v*Math.sin((1-t)*angle)+b[i]*Math.sin(t*angle))/s);}
  const norm=Math.hypot(...q);q=q.map(v=>v/norm);
  const d=Math.hypot(q[0],q[1],q[2]);
  return d<1e-10?[1,0,0,0]:[q[0]/d,q[1]/d,q[2]/d,2*Math.atan2(d,q[3])];
}

export function createCameraRig(browser, { boardOrigin, skylinePose = null, ms = 900 }) {
  const sc = browser.currentScene;
  const vp = sc.getNamedNode("vp_focus");
  const pose = (name) => { const n = sc.getNamedNode(name); return { p: [n.position.x, n.position.y, n.position.z], o: [n.orientation.x, n.orientation.y, n.orientation.z, n.orientation.angle] }; };
  const poses = { overview: pose("vp_overview"), phase: pose("vp_phase") };
  let cur = structuredClone(poses.overview), anim = null, bound = false, name = "overview";
  const apply = (q) => { vp.position = new X3D.SFVec3f(...q.p); vp.orientation = new X3D.SFRotation(...q.o); };
  const boardPose = (i) => { const o = boardOrigin(i); return { p: [o[0], 11.3, o[2] + 10.0], o: [1, 0, 0, -0.85] }; };
  const topPose = (i) => { const o = boardOrigin(i); return { p: [o[0], 14.5, o[2]], o: [1, 0, 0, -Math.PI/2] }; };
  const blackPose = (i) => { const o = boardOrigin(i); return { p: [o[0], 11.3, o[2] - 10.0], o: [0, Math.cos(.425), Math.sin(.425), Math.PI] }; };

  function flyTo(target, label) {
    if (!bound) { apply(cur); vp.set_bind = true; bound = true; }
    anim = { from: structuredClone(cur), to: target, t0: performance.now() };
    name = label;
  }
  function tick(now) {
    if (!anim) return;
    const k = Math.min(1, (now - anim.t0) / ms), e = ease(k);
    cur = { p: anim.from.p.map((v, i) => lerp(v, anim.to.p[i], e)), o: orientationBetween(anim.from.o, anim.to.o, e) };
    apply(cur);
    if (k >= 1) anim = null;
  }
  return {
    tick, get name() { return name; }, get flying() { return !!anim; },
    pose: () => structuredClone(cur),
    overview: () => flyTo(poses.overview, "overview"),
    phase: () => flyTo(poses.phase, "phase"),
    skyline: () => skylinePose && flyTo(skylinePose, "skyline"),
    board: (i) => flyTo(boardPose(i), `board_${i}`),
    boardTop: (i) => flyTo(topPose(i), `board_${i}_top`),
    boardBlack: (i) => flyTo(blackPose(i), `board_${i}_black`),
  };
}
