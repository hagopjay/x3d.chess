// WasmEnginePool: M Stockfish workers shared by N boards (docs/ARCHITECTURE.md "Why a pool").
// Engine: Stockfish 19 lite single-thread WASM (vendor/stockfish, GPL-3.0), driven over UCI via postMessage.
const SF_URL = new URL("../vendor/stockfish/stockfish-19-lite-single.js", import.meta.url).href;

class EngineWorker {
  constructor(url) {
    this.w = new Worker(url);
    this.waiters = [];
    this.lineHook = null;
    this.w.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : String(e.data);
      this.lineHook?.(line);
      for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].re.test(line)) this.waiters.splice(i, 1)[0].res(line);
    };
  }
  send(cmd) { this.w.postMessage(cmd); }
  waitFor(re) { return new Promise((res) => this.waiters.push({ re, res })); }
  async init() {
    this.send("uci"); await this.waitFor(/^uciok/);
    this.send("setoption name Threads value 1"); this.send("setoption name Hash value 16");
    this.send("isready"); await this.waitFor(/^readyok/);
  }
  terminate() { this.w.terminate(); }
}

export class WasmEnginePool {
  constructor({ size = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))), url = SF_URL } = {}) {
    this.size = size; this.url = url; this.free = []; this.queue = []; this.searches = 0; this.nodes = 0; this.busyMs = 0;
  }
  async init() {
    const ws = Array.from({ length: this.size }, () => new EngineWorker(this.url));
    await Promise.all(ws.map((w) => w.init()));
    this.free.push(...ws); this.all = ws;
  }
  _lease() {
    if (this.free.length) return Promise.resolve(this.free.pop());
    return new Promise((res) => this.queue.push(res));
  }
  _release(w) { const q = this.queue.shift(); q ? q(w) : this.free.push(w); }

  /** @returns {{uci:string, cp:number|null, mate:number|null, depth:number, nodes:number}}  cp/mate are WHITE-positive. */
  async search(fen, { depth = 12, skill = 20 } = {}) {
    const w = await this._lease();
    const t0 = performance.now();
    try {
      let info = null;
      w.lineHook = (line) => {
        if (!line.startsWith("info") || !/ score /.test(line) || / multipv (?!1\b)/.test(line)) return;
        const d = /depth (\d+)/.exec(line), n = /nodes (\d+)/.exec(line), cp = /score cp (-?\d+)/.exec(line), m = /score mate (-?\d+)/.exec(line);
        info = { depth: d ? +d[1] : 0, nodes: n ? +n[1] : 0, cp: cp ? +cp[1] : null, mate: m ? +m[1] : null };
      };
      w.send(`setoption name Skill Level value ${skill}`);
      w.send("ucinewgame");
      w.send(`position fen ${fen}`);
      w.send(`go depth ${depth}`);
      const best = await w.waitFor(/^bestmove /);
      w.lineHook = null;
      const uci = best.split(" ")[1];
      const stm = fen.split(" ")[1];                // score is side-to-move relative; flip to white-positive
      const sign = stm === "w" ? 1 : -1;
      this.searches++; this.nodes += info?.nodes || 0; this.busyMs += performance.now() - t0;
      return {
        uci: uci === "(none)" ? null : uci,
        cp: info?.cp != null ? sign * info.cp : null,
        mate: info?.mate != null ? sign * info.mate : null,
        depth: info?.depth || 0, nodes: info?.nodes || 0,
      };
    } finally { this._release(w); }
  }
  terminate() { this.all?.forEach((w) => w.terminate()); }
}
