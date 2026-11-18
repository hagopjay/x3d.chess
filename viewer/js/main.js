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
const scene = await createScene(browser, { boards });
const engine = q.get("engine") ?? "replay";             // replay | wasm | sse
const Cls = { replay: ReplayTransport, wasm: WasmTransport, sse: SseTransport }[engine];
const transport = new Cls((ev) => scene.onEvent(ev));
await transport.start({ boards, seed, intervalMs: interval, depth: +(q.get("depth") ?? 12), poolSize: +(q.get("pool") || 0) || undefined, url: q.get("server") || undefined });
window.x3dchess = { scene, transport };
setInterval(() => { status.textContent = `${boards} boards · ${scene.pieceCount()} pieces · ${scene.stats.moves} moves · ${engine}${engine === 'replay' ? ' (material proxy)' : ''}`; }, 500);

for (const b of document.querySelectorAll("#views button")) {
  b.onclick = () => { browser.currentScene.getNamedNode(b.dataset.vp).set_bind = true; };
}
