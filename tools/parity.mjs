// Parity gate: JS analysis twins vs Python outputs recorded in server/tests/parity_fixtures.json.
import fs from "node:fs";
import { Chess } from "../viewer/vendor/chess.js";
import { phaseSpacePoint, detectTactics, BifurcationDetector } from "../viewer/js/analysis.js";

const fx = JSON.parse(fs.readFileSync(new URL("../server/tests/parity_fixtures.json", import.meta.url)));
const bad = { phase: [], tactics: [], critical: [] };
let tacticCount = 0;
for (const p of fx.positions) {
  const c = new Chess(p.fen);
  const j = phaseSpacePoint(c);
  for (const k of Object.keys(p.phase)) if (Math.abs(j[k] - p.phase[k]) > 0.011) bad.phase.push({ fen: p.fen, k, js: j[k], py: p.phase[k] });
  const jt = JSON.stringify(detectTactics(c)), pt = JSON.stringify(p.tactics);
  tacticCount += p.tactics.length;
  if (jt !== pt) bad.tactics.push({ fen: p.fen, js: JSON.parse(jt), py: p.tactics });
}
let steps = 0, flagged = 0;
for (const seq of fx.critical) {
  const bd = new BifurcationDetector();
  for (const s of seq) {
    const got = bd.add(s.ply, s.eval, s.fen); steps++; if (s.critical) flagged++;
    if (got !== s.critical) bad.critical.push({ ply: s.ply, js: got, py: s.critical });
  }
}
console.log(JSON.stringify({ positions: fx.positions.length, tacticMotifs: tacticCount, criticalSteps: steps, criticalFlagged: flagged,
  mismatches: { phase: bad.phase.length, tactics: bad.tactics.length, critical: bad.critical.length } }));
if (bad.phase.length + bad.tactics.length + bad.critical.length) { console.log(JSON.stringify(bad).slice(0, 1500)); process.exit(1); }
