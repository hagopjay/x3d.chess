// Headless-Chromium smoke test: loads the viewer, checks all 64 squares resolve via SAI, screenshots.
// X_ITE comes from the local npm copy (X_ITE_DIR) so the test does not depend on a CDN.
// usage: X_ITE_DIR=/path/to/x_ite/dist node tools/smoke.mjs [out.png]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // CJS resolve honours NODE_PATH
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../viewer", import.meta.url).pathname);
const xiteDir = process.env.X_ITE_DIR;
if (!xiteDir) throw new Error("set X_ITE_DIR to an x_ite dist directory");
const types = { ".html": "text/html", ".js": "text/javascript", ".x3d": "model/x3d+xml", ".css": "text/css", ".wasm": "application/wasm" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = u.startsWith("/__xite/") ? path.join(xiteDir, u.slice(8)) : path.join(root, u === "/" ? "index.html" : u);
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(b); });
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://cdn.jsdelivr.net/npm/x_ite@*/dist/**", (r) => {
  const rel = r.request().url().split("/dist/")[1];
  r.fulfill({ path: path.join(xiteDir, rel) });
});
const query = process.env.QUERY || "";
await page.goto(`http://localhost:${port}/${query}`);
await page.waitForFunction(() => window.x3dchess, null, { timeout: 30000 });
await page.waitForTimeout(Number(process.env.WAIT_MS || 8000));
await page.evaluate(async () => { await window.x3dchess.transport.stop(); await new Promise(r => setTimeout(r, 300)); await window.x3dchess.scene.settled(); });
const n = await page.evaluate(() => window.x3dchess.scene.pieceCount());
await page.waitForTimeout(1500);
const misplaced = await page.evaluate(() => window.x3dchess.scene.misplaced());
const kids = await page.evaluate(() => window.x3dchess.scene.childCount());
const eng = await page.evaluate(() => window.x3dchess.transport.pool ? { searches: window.x3dchess.transport.pool.searches, nodes: window.x3dchess.transport.pool.nodes, workers: window.x3dchess.transport.pool.size, busyMs: Math.round(window.x3dchess.transport.pool.busyMs) } : null);
const st = await page.evaluate(() => ({ ...window.x3dchess.scene.stats, phasePoints: window.x3dchess.scene.phase.points() }));
const moves = st.moves;
await page.screenshot({ path: process.argv[2] || "smoke.png" });
if (process.env.PHASE_PNG) {
  await page.click("button[data-vp=vp_phase]"); await page.waitForTimeout(2500);
  await page.screenshot({ path: process.env.PHASE_PNG });
}

console.log(JSON.stringify({ pieces: n, sceneChildren: kids, misplaced, moves, stats: st, engine: eng, errors }));
await browser.close(); srv.close();
process.exit(n >= 300 && n === kids && misplaced === 0 && moves > 50 && errors.length === 0 ? 0 : 1);
