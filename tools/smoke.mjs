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
const types = { ".html": "text/html", ".js": "text/javascript", ".x3d": "model/x3d+xml", ".css": "text/css" };
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
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.x3dchess, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const n = await page.evaluate(() => window.x3dchess.squareCount());
await page.screenshot({ path: process.argv[2] || "smoke.png" });
console.log(JSON.stringify({ squares: n, errors }));
await browser.close(); srv.close();
process.exit(n === 64 && errors.length === 0 ? 0 : 1);
