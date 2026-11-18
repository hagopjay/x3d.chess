// SseTransport: consumes /events from server/ (Python + native Stockfish). Same events as the other transports.
import { Transport } from "./transport.js";

export class SseTransport extends Transport {
  async start({ url = "http://127.0.0.1:8080/events" } = {}) {
    this.es = new EventSource(url);
    this.es.onmessage = (m) => {
      try { this.onEvent(JSON.parse(m.data)); } catch (e) { console.warn("bad event", e); }
    };
    this.es.onerror = () => console.warn("SSE connection issue, EventSource will retry");
  }
  async stop() { this.es?.close(); }
}
