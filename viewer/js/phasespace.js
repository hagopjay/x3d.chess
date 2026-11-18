// 3D phase space (original: PhaseSpace.tsx, 2D projection). Axes: material_balance (x), space_control (y),
// king_safety (z). Each game is a glowing sphere with a polyline trail; trail length is capped.
const SCALE = 0.7, CLAMP = 5, TRAIL = 60;
const clampv = (v) => Math.max(-CLAMP, Math.min(CLAMP, v)) * SCALE;
const hue = (i, n) => { const h = (i / n) * 6, f = h - Math.floor(h), q = 1 - f; const t = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][Math.floor(h) % 6]; return t.map((x) => (0.35 + 0.65 * x).toFixed(2)).join(" "); };

export async function createPhaseSpace(browser, origin, n) {
  const half = CLAMP * SCALE;
  const box = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => `${x * half} ${y * half} ${z * half}`).join(", ");
  const axes = `0 0 0, ${half} 0 0, 0 ${half} 0, 0 0 ${half}`;
  const label = (t, p) => `<Transform translation='${p}'><Billboard axisOfRotation='0 0 0'><Shape><Appearance><Material emissiveColor='0.8 0.9 1' diffuseColor='0 0 0'/></Appearance><Text string='"${t}"'><FontStyle size='0.45' justify='"MIDDLE" "MIDDLE"'/></Text></Shape></Billboard></Transform>`;
  const dots = Array.from({ length: n }, (_, i) => `<Transform DEF='ps_${i}'><Shape><Appearance><Material diffuseColor='${hue(i, n)}' emissiveColor='${hue(i, n)}'/></Appearance><Sphere radius='0.11'/></Shape></Transform>
    <Shape><Appearance><Material emissiveColor='${hue(i, n)}' diffuseColor='0 0 0'/></Appearance><IndexedLineSet DEF='trail_${i}' coordIndex='-1'><Coordinate DEF='trailc_${i}' point='0 0 0'/></IndexedLineSet></Shape>`).join("\n");
  const xml = `<X3D profile='Interchange' version='4.0'><head><component name='Text' level='1'/></head><Scene><Transform translation='${origin.join(" ")}'>
    <Shape><Appearance><Material emissiveColor='0.25 0.35 0.5' diffuseColor='0 0 0'/></Appearance>
      <IndexedLineSet coordIndex='0 1 2 3 0 -1 4 5 6 7 4 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1'><Coordinate point='${box}'/></IndexedLineSet></Shape>
    <Shape><Appearance><Material emissiveColor='1 1 1' diffuseColor='0 0 0'/></Appearance>
      <IndexedLineSet coordIndex='0 1 -1 0 2 -1 0 3 -1'><Coordinate point='${axes}'/></IndexedLineSet></Shape>
    ${label("material", `${half + 0.8} 0 0`)}${label("space", `0 ${half + 0.6} 0`)}${label("king safety", `0 0 ${half + 0.8}`)}
    ${dots}
  </Transform></Scene></X3D>`;
  const s = await browser.createX3DFromString(xml);
  const root = s.rootNodes[0];
  browser.currentScene.addRootNode(root);
  const trails = Array.from({ length: n }, () => []);
  const get = (name) => s.getNamedNode(name);
  return {
    update(ev) {
      const i = +ev.game_id.slice(1);
      if (!(i >= 0 && i < n)) return;
      const p = [clampv(ev.material_balance), clampv(ev.space_control), clampv(ev.king_safety)];
      get(`ps_${i}`).translation = new X3D.SFVec3f(...p);
      const t = trails[i]; t.push(p); if (t.length > TRAIL) t.shift();
      get(`trailc_${i}`).point = new X3D.MFVec3f(...t.map((q) => new X3D.SFVec3f(...q)));
      get(`trail_${i}`).coordIndex = new X3D.MFInt32(...t.map((_, k) => k), -1);
    },
    reset(gameId) { trails[+gameId.slice(1)].length = 0; },
    points: () => trails.reduce((a, t) => a + t.length, 0),
  };
}
