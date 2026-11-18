// EventSource reconnects automatically; expose that state and ignore callbacks after stop/restart.
import { Transport } from "./transport.js";
const GAME_TYPES = new Set(["snapshot_game", "move", "game_complete", "phase_space_update"]);
export class SseTransport extends Transport {
  constructor(onEvent, { eventSourceFactory = (url) => new EventSource(url) } = {}) { super(onEvent); this.eventSourceFactory = eventSourceFactory; }
  async start({ url = "http://127.0.0.1:8080/events" } = {}) {
    const endpoint = new URL(url, globalThis.location?.href || "http://localhost/");
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new TypeError("SSE requires an HTTP(S) URL without credentials");
    const request = ++this.startRequest; await this.stop({ silent: true, fromStart: true });
    if (request !== this.startRequest) return;
    const run = this.begin("sse");
    try {
      const source = this.eventSourceFactory(endpoint.href); this.es = source;
      source.onopen = () => { if (this.active(run)) this.status("running", "Connected to the chess server"); };
      source.onmessage = ({ data }) => {
        if (!this.active(run)) return;
        let event;
        try {
          if (typeof data !== "string" || data.length > 262144) throw new Error("SSE event exceeds its input budget");
          event = JSON.parse(data);
          if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error("Malformed SSE event");
          if (GAME_TYPES.has(event.type) && (typeof event.game_id !== "string" || !event.game_id || event.game_id.length > 160)) throw new Error("SSE game event lacks an identity");
        } catch (error) { source.close(); this.halt(); this.status("error", `Rejected server event: ${error.message}`); return; }
        // Do not catch scene callback errors and mislabel them as malformed JSON.
        this.onEvent(event);
      };
      source.onerror = () => {
        if (this.active(run)) this.status(source.readyState === 2 ? "error" : "retrying",
          source.readyState === 2 ? "Chess server connection closed" : "Chess server disconnected; waiting for reconnection snapshots");
      };
    } catch (error) { if (this.active(run)) { this.halt(); this.status("error", error.message); } throw error; }
  }
  async stop({ silent = false, fromStart = false } = {}) { if (!fromStart) this.startRequest++; this.halt(); this.es?.close(); this.es = null; if (!silent) this.status("stopped", "Server connection stopped"); }
}
