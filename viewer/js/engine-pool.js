// Bounded Stockfish UCI workers shared by all boards. No replay fallback.
const SF_URL = new URL("../vendor/stockfish/stockfish-19-lite-single.js", import.meta.url).href;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const abortError = () => Object.assign(new Error("Engine pool stopped"), { name: "AbortError" });
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer ${min}–${max}`);
  return value;
}
function positionFen(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) throw new TypeError("Expected one FEN line");
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 6 || !/^[prnbqkPRNBQK1-8/]+$/.test(fields[0]) || !/^[wb]$/.test(fields[1]) ||
      !/^(?:-|K?Q?k?q?)$/.test(fields[2]) || !/^(?:-|[a-h][36])$/.test(fields[3]) ||
      !/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5])) throw new TypeError("Malformed FEN command");
  return fields.join(" ");
}

class EngineWorker {
  constructor(url, factory, fatal) {
    this.waiters = new Set(); this.lineHook = null; this.failure = null; this.gameKey = null; this.fatal = fatal;
    this.w = factory(url);
    this.w.onmessage = ({ data }) => {
      if (this.failure) return;
      for (const line of String(data).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        if (line.startsWith("id name ")) this.engineName = line.slice(8, 168);
        if (/^info string (?:CRITICAL ERROR|ERROR)/i.test(line)) { this.fail(new Error(line)); return; }
        try { this.lineHook?.(line); } catch (error) { this.fail(error); return; }
        for (const waiter of [...this.waiters]) if (waiter.re.test(line)) waiter.finish(null, line);
      }
    };
    this.w.onerror = (event) => { event.preventDefault?.(); this.fail(new Error(`Stockfish worker failed: ${event.message || "worker error"}`)); };
    this.w.onmessageerror = () => this.fail(new Error("Stockfish worker message could not be decoded"));
  }
  send(command) {
    if (this.failure) throw this.failure;
    try { this.w.postMessage(command); } catch (error) { this.fail(error); throw error; }
  }
  waitFor(re, timeoutMs) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { re, finish: (error, line) => {
        clearTimeout(waiter.timer); this.waiters.delete(waiter); error ? reject(error) : resolve(line);
      } };
      waiter.timer = setTimeout(() => this.fail(new Error(`Stockfish timed out waiting for ${re.source}`)), timeoutMs);
      this.waiters.add(waiter);
    });
  }
  async command(command, re, timeoutMs) {
    // Register before postMessage: a fast engine or test worker can reply immediately.
    const response = this.waitFor(re, timeoutMs);
    try { this.send(command); } catch (_) { /* fail() rejects response as well */ }
    return response;
  }
  async init(timeoutMs) {
    await this.command("uci", /^uciok$/, timeoutMs);
    this.send("setoption name Threads value 1"); this.send("setoption name Hash value 16");
    await this.command("isready", /^readyok$/, timeoutMs);
  }
  fail(error, notify = true) {
    if (this.failure) return;
    this.failure = error; this.lineHook = null;
    for (const waiter of [...this.waiters]) waiter.finish(error);
    this.w.terminate();
    if (notify) this.fatal(error);
  }
}

export class WasmEnginePool {
  constructor({ size = Math.max(1, Math.min(4, Math.floor((globalThis.navigator?.hardwareConcurrency || 4) / 2))),
    url = SF_URL, workerFactory = (source) => new Worker(source), initTimeoutMs = 15000,
    searchTimeoutMs = 60000, queueLimit = 64, onError = () => {} } = {}) {
    this.size = integer(size, 1, 8, "Worker count"); this.url = url; this.workerFactory = workerFactory;
    this.initTimeoutMs = integer(initTimeoutMs, 1, 120000, "Initialization timeout");
    this.searchTimeoutMs = integer(searchTimeoutMs, 1, 300000, "Search timeout");
    this.queueLimit = integer(queueLimit, 0, 256, "Queue limit"); this.onError = onError;
    this.free = []; this.queue = []; this.all = []; this.closed = false; this.state = "new";
    this.searches = 0; this.nodes = 0; this.busyMs = 0;
  }
  async init() {
    if (this.closed) throw this.failure;
    if (this.initPromise) return this.initPromise;
    this.state = "starting";
    this.initPromise = (async () => {
      try {
        for (let i = 0; i < this.size; i++) this.all.push(new EngineWorker(this.url, this.workerFactory, (e) => this._fail(e)));
        await Promise.all(this.all.map((w) => w.init(this.initTimeoutMs)));
        if (this.closed) throw this.failure;
        this.free.push(...this.all); this.engineNames = [...new Set(this.all.map((w) => w.engineName).filter(Boolean))]; this.state = "running";
      } catch (error) { this._fail(error); throw error; }
    })();
    return this.initPromise;
  }
  _fail(error) { this.terminate(error); if (error.name !== "AbortError" && !this.errorReported) { this.errorReported = true; this.onError(error); } }
  _lease() {
    if (this.closed) return Promise.reject(this.failure);
    if (this.state !== "running") return Promise.reject(new Error("Engine pool is not initialized"));
    if (this.free.length) return Promise.resolve(this.free.pop());
    if (this.queue.length >= this.queueLimit) return Promise.reject(new Error("Engine request queue is full"));
    return new Promise((resolve, reject) => this.queue.push({ resolve, reject }));
  }
  _release(worker) {
    if (this.closed || worker.failure) return;
    const next = this.queue.shift(); next ? next.resolve(worker) : this.free.push(worker);
  }
  /** Scores describe the supplied pre-move position, from White's point of view.
   * initialFen + moves preserves repetition history after the seeded opening.
   */
  async search(fen, { depth = 12, skill = 20, initialFen = fen, moves = [], gameKey = "analysis" } = {}) {
    fen = positionFen(fen); initialFen = positionFen(initialFen);
    integer(depth, 1, 30, "Search depth"); integer(skill, 0, 20, "Skill level");
    if (!Array.isArray(moves) || moves.length > 512 || moves.some((m) => typeof m !== "string" || !UCI_MOVE.test(m))) throw new TypeError("Invalid UCI move history");
    if (typeof gameKey !== "string" || !gameKey || gameKey.length > 160) throw new TypeError("Invalid game identity");
    const history = moves.slice(), worker = await this._lease(), t0 = performance.now();
    try {
      if (this.closed) throw this.failure;
      let info = null, nodes = 0;
      worker.lineHook = (line) => {
        if (!line.startsWith("info ")) return;
        const n = /\bnodes (\d+)/.exec(line); if (n && Number.isSafeInteger(+n[1])) nodes = Math.max(nodes, +n[1]);
        if (!/\bscore /.test(line) || /\bmultipv (?!1\b)/.test(line)) return;
        const d = /\bdepth (\d+)/.exec(line), cp = /\bscore cp (-?\d+)/.exec(line), mate = /\bscore mate (-?\d+)/.exec(line);
        if (!cp && !mate) return;
        const next = { depth: d ? +d[1] : 0, cp: cp ? +cp[1] : null, mate: mate ? +mate[1] : null,
          bound: /\blowerbound\b/.test(line) ? "lowerbound" : /\bupperbound\b/.test(line) ? "upperbound" : "exact" };
        if (!info || next.depth >= info.depth) info = next;
      };
      worker.send(`setoption name Skill Level value ${skill}`);
      if (worker.gameKey !== gameKey) { worker.send("ucinewgame"); worker.gameKey = gameKey; }
      await worker.command("isready", /^readyok$/, this.initTimeoutMs);
      worker.send(`position fen ${initialFen}${history.length ? " moves " + history.join(" ") : ""}`);
      const best = await worker.command(`go depth ${depth}`, /^bestmove(?:\s|$)/, this.searchTimeoutMs);
      const uci = best.split(/\s+/)[1];
      if (!UCI_MOVE.test(uci) && uci !== "0000" && uci !== "(none)") throw new Error("Stockfish returned an invalid UCI bestmove");
      const sign = fen.split(" ")[1] === "w" ? 1 : -1, bound = info?.bound || null;
      this.searches++; this.nodes += nodes; this.busyMs += performance.now() - t0;
      return { uci: uci === "0000" || uci === "(none)" ? null : uci,
        cp: info?.cp != null ? sign * info.cp : null, mate: info?.mate != null ? sign * info.mate : null,
        depth: info?.depth || 0, nodes, score_pov: "white", eval_fen: fen,
        score_bound: sign < 0 && bound && bound !== "exact" ? (bound === "lowerbound" ? "upperbound" : "lowerbound") : bound };
    } catch (error) { if (error.name !== "AbortError") this._fail(error); throw error; }
    finally { worker.lineHook = null; this._release(worker); }
  }
  terminate(reason = abortError()) {
    if (this.closed) return;
    this.closed = true; this.failure = reason; this.state = reason.name === "AbortError" ? "stopped" : "error";
    for (const waiting of this.queue.splice(0)) waiting.reject(reason);
    this.free.length = 0; for (const worker of this.all) worker.fail(reason, false);
  }
}
