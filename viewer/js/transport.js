// All transports emit the protocol's game events plus explicit lifecycle status.
export function integerOption(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer ${min}–${max}`);
  return value;
}
// Browser policy claims only a draw already reached in the current position.
// The Python server's claim_available policy also recognizes prospective claims.
export function terminalResult(chess, ply, cap, capReason) {
  const mate = chess.isCheckmate();
  const repeated = chess.isThreefoldRepetition();
  let fivefold = false;
  if (repeated && typeof chess.repetitionCount === "function") fivefold = chess.repetitionCount() >= 5;   // Chess960: rights-aware count
  else if (repeated) {
    const position = (fen) => fen.split(" ").slice(0, 4).join(" "), key = position(chess.fen());
    fivefold = 1 + chess.history({ verbose: true }).filter((move) => position(move.before) === key).length >= 5;
  }
  const halfmoves = Number(chess.fen().split(" ")[4]);
  const reason = mate ? "checkmate" : chess.isStalemate() ? "stalemate" : chess.isInsufficientMaterial() ? "insufficient_material"
    : halfmoves >= 150 ? "seventyfive_move" : fivefold ? "fivefold"
      : repeated ? "threefold" : chess.isDrawByFiftyMoves() ? "fifty_move" : ply >= cap ? capReason : null;
  if (!reason) return null;
  return { result: mate ? (chess.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2", reason,
    state: "complete", adjudicated: reason === capReason || reason === "threefold" || reason === "fifty_move",
    draw_policy: "claim_current_position" };
}
export class Transport {
  constructor(onEvent) {
    if (typeof onEvent !== "function") throw new TypeError("Transport requires an event callback");
    this.onEvent = onEvent; this.state = "idle"; this.running = false; this.run = 0; this.startRequest = 0; this.timers = new Map();
  }
  status(state, message, details = {}) {
    this.state = state; this.onEvent({ type: "transport_status", transport: this.kind, state, message, ...details });
  }
  begin(kind) { this.kind = kind; this.running = true; this.run++; this.status("starting", `Starting ${kind} transport`); return this.run; }
  active(run) { return this.running && this.run === run; }
  halt() {
    this.running = false; this.run++;
    for (const [timer, resolve] of this.timers) { clearTimeout(timer); resolve(false); }
    this.timers.clear();
  }
  delay(ms, run) {
    if (!this.active(run)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.active(run)); }, ms);
      this.timers.set(timer, resolve);
    });
  }
  gameEvent(game, event) { this.onEvent({ ...event, generation: game.generation, seq: ++game.seq }); }
  async start(_config) { throw new Error("Transport.start must be implemented"); }
  async stop({ silent = false } = {}) { this.halt(); if (!silent) this.status("stopped", "Transport stopped"); }
}
