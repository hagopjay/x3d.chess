import { createScene } from "./scene.js";
import { ReplayTransport } from "./replay.js";
import { WasmTransport } from "./wasm-transport.js";
import { SseTransport } from "./sse-transport.js";

const q = new URLSearchParams(location.search);
const boards = +(q.get("boards") ?? 20), seed = +(q.get("seed") ?? 1), interval = +(q.get("interval") ?? 700);
const canvas = document.getElementById("canvas");
const status = document.getElementById("status");

const browser = X3D.getBrowser(canvas);
await browser.loadComplete?.catch?.(() => {});
const scene = await createScene(browser, { boards, panelEl: document.getElementById("panel") });
const engine = q.get("engine") ?? "replay";             // replay | wasm | sse
const Cls = { replay: ReplayTransport, wasm: WasmTransport, sse: SseTransport }[engine];
const transport = new Cls((ev) => scene.onEvent(ev));
await transport.start({ boards, seed, intervalMs: interval, depth: +(q.get("depth") ?? 12), poolSize: +(q.get("pool") || 0) || undefined, url: q.get("server") || undefined });
window.x3dchess = { scene, transport };
let heatOn = q.get("heat") === "1";
if (heatOn) scene.setHeat(true);
const toggleHeat = () => { heatOn = !heatOn; scene.setHeat(heatOn); document.getElementById("heatbtn").style.opacity = heatOn ? 1 : 0.55; };
document.getElementById("heatbtn").onclick = toggleHeat;
addEventListener("keydown", (e) => { if (e.key === "h") toggleHeat(); });
setInterval(() => { status.textContent = `${boards} boards · ${scene.pieceCount()} pieces · ${scene.stats.moves} moves · ${engine}${engine === 'replay' ? ' (material proxy)' : ''}`; }, 500);

document.querySelector("[data-vp=vp_overview]").onclick = () => scene.deselect();
document.querySelector("[data-vp=vp_phase]").onclick = () => { scene.deselect(); scene.rig.phase(); };
document.getElementById("themebtn").onclick = () => scene.cycleTheme();
addEventListener("keydown", (e) => {
  if (e.key === "Escape") scene.deselect();
  else if (e.key === "ArrowRight") scene.nextBoard(1);
  else if (e.key === "ArrowLeft") scene.nextBoard(-1);
  else if (e.key === "t") scene.cycleTheme();
});
const th = q.get("theme"); if (th) scene.setTheme(th);
