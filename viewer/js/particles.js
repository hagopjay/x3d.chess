// Capture burst: a short-lived X3D ParticleSystem (POINT geometry) at the capture square, removed after ~0.7 s.
// Capped so a burst storm cannot pile up nodes.
let live = 0;
const MAX = 6;

export async function burst(browser, [x, y, z], color = "1 0.5 0.15", { isAlive = () => true } = {}) {
  if (live >= MAX) return;
  live++;
  const scene = browser.currentScene;
  try {
    const s = await browser.createX3DFromString(`<X3D profile='Interchange' version='4.0'><head><component name='ParticleSystems' level='2'/></head><Scene>
      <Transform translation='${x} ${y + 0.3} ${z}'><ParticleSystem geometryType='POINT' maxParticles='40' particleLifetime='0.55' lifetimeVariation='0.3' particleSize='0.12 0.12'>
        <Appearance><Material emissiveColor='${color}' diffuseColor='${color}'/></Appearance>
        <PointEmitter direction='0 1 0' speed='2.2' variation='1.2' mass='0.01'/>
      </ParticleSystem></Transform></Scene></X3D>`);
    const node = s.rootNodes[0];
    if (!isAlive() || browser.currentScene !== scene) { live--; return; }
    scene.addRootNode(node);
    let active = true;
    const cleanup = () => { if (!active) return; active = false; clearTimeout(timer); try { scene.removeRootNode(node); } catch {} live--; };
    const timer = setTimeout(cleanup, 750);
    return cleanup;
  } catch (e) { live--; console.warn("particles", e); }
}
