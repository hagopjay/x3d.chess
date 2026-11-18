// Thin SAI wrapper. Node names are the contract in docs/X3D-MAPPING.md:
// sq_<file><rank>, piece_<square>, evalbar.
export function createScene(browser) {
  const node = (name) => browser.currentScene.getNamedNode(name);
  const files = "abcdefgh";
  return {
    node,
    squareCount() {
      let n = 0;
      for (const f of files) for (let r = 1; r <= 8; r++) { try { node(`sq_${f}${r}`); n++; } catch {} }
      return n;
    },
    // Scaffold-level setters; the full set (move animation, tint, heatmap) lands in build-out.
    setEval(pawns) {                    // clamp to +-8 pawns, scale bar on Z
      const t = node("evalbar");
      t.scale = new X3D.SFVec3f(1, 1, Math.max(0.05, 0.5 + Math.max(-8, Math.min(8, pawns)) / 16));
    },
  };
}
