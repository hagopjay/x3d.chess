// Transport contract. Both implementations emit the same events (docs/PROTOCOL.md):
//   SseTransport  -> server/ (Python + native Stockfish, runs on the owner's PC)
//   WasmTransport -> stockfish.wasm in Web Workers (GitHub Pages, no server)
// Build-out phase implements both; this file fixes the interface so the viewer is transport-agnostic.
export class Transport {
  /** @param {(ev: object) => void} onEvent */
  constructor(onEvent) { this.onEvent = onEvent; }
  async start(_config) { throw new Error("not implemented (build-out phase)"); }
  async stop() {}
}
