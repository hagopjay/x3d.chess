// Scaffold entry point. Build-out phase wires a Transport (see transport.js) to the scene.
import { createScene } from "./scene.js";

const canvas = document.getElementById("canvas");
const status = document.getElementById("status");

const browser = X3D.getBrowser(canvas);
await browser.loadComplete?.catch?.(() => {});
const scene = createScene(browser);
window.x3dchess = scene;               // debugging / smoke hook
status.textContent = `${scene.squareCount()} squares ready`;
