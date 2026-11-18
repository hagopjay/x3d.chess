// Parity gate: JS analysis twins vs Python outputs recorded in server/tests/parity_fixtures.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { Chess } from "../viewer/vendor/chess.js";
import {
  phaseSpacePoint,
  detectTactics,
  BifurcationDetector,
} from "../viewer/js/analysis.js";

const fx = JSON.parse(
  fs.readFileSync(
    new URL("../server/tests/parity_fixtures.json", import.meta.url),
  ),
);
if (fx.schema !== "x3dchess.analysis-parity/2" || !fx.source_sha256)
  throw new Error("Missing corrected-analysis fixture identity");
for (const [file, expected] of Object.entries(fx.source_sha256)) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(file) ||
    file.split("/").includes("..") ||
    !/^[0-9a-f]{64}$/.test(expected)
  )
    throw new Error("Invalid fixture producer identity");
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(new URL("../" + file, import.meta.url)))
    .digest("hex");
  if (actual !== expected)
    throw new Error(
      "STALE_PARITY_FIXTURE: " + file + "; regenerate with tools/parity_gen.py",
    );
}
const bad = { phase: [], tactics: [], critical: [] };
let tacticCount = 0;
for (const p of fx.positions) {
  const c = new Chess(p.fen);
  const j = phaseSpacePoint(c);
  for (const k of Object.keys(p.phase))
    if (Math.abs(j[k] - p.phase[k]) > 0.011)
      bad.phase.push({ fen: p.fen, k, js: j[k], py: p.phase[k] });
  const jt = JSON.stringify(detectTactics(c)),
    pt = JSON.stringify(p.tactics);
  tacticCount += p.tactics.length;
  if (jt !== pt)
    bad.tactics.push({ fen: p.fen, js: JSON.parse(jt), py: p.tactics });
}
let steps = 0,
  flagged = 0;
for (const seq of fx.critical) {
  const bd = new BifurcationDetector();
  for (const s of seq) {
    const got = bd.add(s.ply, s.eval, s.fen);
    steps++;
    if (s.critical) flagged++;
    if (got !== s.critical)
      bad.critical.push({ ply: s.ply, js: got, py: s.critical });
  }
}
console.log(
  JSON.stringify({
    schema: "x3dchess.analysis-parity-result/2",
    producerIdentitiesChecked: Object.keys(fx.source_sha256).length,
    node: process.versions.node,
    fixtureSha256: crypto
      .createHash("sha256")
      .update(
        fs.readFileSync(
          new URL("../server/tests/parity_fixtures.json", import.meta.url),
        ),
      )
      .digest("hex"),
    positions: fx.positions.length,
    tacticMotifs: tacticCount,
    criticalSteps: steps,
    criticalFlagged: flagged,
    mismatches: {
      phase: bad.phase.length,
      tactics: bad.tactics.length,
      critical: bad.critical.length,
    },
  }),
);
if (bad.phase.length + bad.tactics.length + bad.critical.length) {
  console.log(JSON.stringify(bad).slice(0, 1500));
  process.exit(1);
}
