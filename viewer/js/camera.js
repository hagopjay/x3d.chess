// CameraRig: fly-to between poses by driving the bound `vp_focus` viewpoint from the page
// (Viewpoint has no offsets in X_ITE, so we set position/orientation ourselves; TELEPORT transition, see grid.x3d).
const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, t) => a + (b - a) * t;

export function createCameraRig(browser, { boardOrigin, skylinePose = null, ms = 900 }) {
  const sc = browser.currentScene;
  const vp = sc.getNamedNode("vp_focus");
  const pose = (name) => { const n = sc.getNamedNode(name); return { p: [n.position.x, n.position.y, n.position.z], o: [n.orientation.x, n.orientation.y, n.orientation.z, n.orientation.angle] }; };
  const poses = { overview: pose("vp_overview"), phase: pose("vp_phase") };
  let cur = structuredClone(poses.overview), anim = null, bound = false, name = "overview";
  const apply = (q) => { vp.position = new X3D.SFVec3f(...q.p); vp.orientation = new X3D.SFRotation(...q.o); };
  const boardPose = (i) => { const o = boardOrigin(i); return { p: [o[0], 8.2, o[2] + 7.2], o: [1, 0, 0, -0.85] }; };

  function flyTo(target, label) {
    if (!bound) { apply(cur); vp.set_bind = true; bound = true; }
    anim = { from: structuredClone(cur), to: target, t0: performance.now() };
    name = label;
  }
  function tick(now) {
    if (!anim) return;
    const k = Math.min(1, (now - anim.t0) / ms), e = ease(k);
    cur = { p: anim.from.p.map((v, i) => lerp(v, anim.to.p[i], e)), o: anim.from.o.map((v, i) => lerp(v, anim.to.o[i], e)) };
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
  };
}
