/**
 * AIS vessel positions via AISStream.io (free API key required: AISSTREAM_API_KEY).
 *
 * AISStream is a websocket stream, so this layer keeps a connection open while
 * the layer is being viewed (closing it after 10 idle minutes) and serves the
 * latest position per vessel from memory.
 */
import type { LiveLayerProvider } from "../types";
import { parseAisMessage } from "./parser";
import type { AisStreamMessage, MaritimeData, VesselRow } from "./types";

const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const MAX_VESSELS = 40_000;
const MAX_AGE_MS = 30 * 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;

interface StreamState {
  ws: WebSocket | null;
  vessels: Map<number, VesselRow>;
  lastRequest: number;
  lastMessage: number;
  error: string | null;
  idleTimer: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __worldviewAis?: StreamState };
const state: StreamState = (g.__worldviewAis ??= { ws: null, vessels: new Map(), lastRequest: 0, lastMessage: 0, error: null, idleTimer: null });

function connect(apiKey: string) {
  if (state.ws && state.ws.readyState <= 1) return;
  state.error = null;
  const ws = new WebSocket(STREAM_URL);
  state.ws = ws;
  ws.onopen = () =>
    ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ["PositionReport"] }));
  ws.onmessage = async (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      const msg = JSON.parse(text);
      if (msg?.error) {
        state.error = String(msg.error);
        return;
      }
      const row = parseAisMessage(msg as AisStreamMessage);
      if (!row) return;
      state.lastMessage = Date.now();
      state.vessels.set(row[0], row);
      if (state.vessels.size > MAX_VESSELS) {
        // drop the oldest ~10%
        const oldest = [...state.vessels.values()].sort((a, b) => a[8] - b[8]).slice(0, MAX_VESSELS / 10);
        for (const v of oldest) state.vessels.delete(v[0]);
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onerror = () => (state.error = "AISStream connection error");
  ws.onclose = () => {
    if (state.ws === ws) state.ws = null;
  };
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = setInterval(() => {
    if (Date.now() - state.lastRequest > IDLE_CLOSE_MS) {
      state.ws?.close();
      state.ws = null;
      if (state.idleTimer) clearInterval(state.idleTimer);
      state.idleTimer = null;
    }
  }, 60_000);
  state.idleTimer.unref?.();
}

export const maritimeLayer: LiveLayerProvider<MaritimeData> = {
  id: "maritime",
  name: "Vessels (AISStream)",
  description: "Live AIS ship positions from the AISStream.io terrestrial receiver network. Requires a free AISSTREAM_API_KEY.",
  homepage: "https://aisstream.io/",
  attribution: "AIS data © AISStream.io",
  ttlMs: 60_000,
  checkConfiguration: (env) => (env.AISSTREAM_API_KEY ? null : "AISSTREAM_API_KEY is not set (free key at aisstream.io)"),
  async load(ctx) {
    state.lastRequest = ctx.now;
    connect(ctx.env.AISSTREAM_API_KEY!);
    if (state.error) throw new Error(state.error);
    const cutoff = ctx.now - MAX_AGE_MS;
    const rows = [...state.vessels.values()].filter((v) => v[8] >= cutoff);
    return {
      layerId: "maritime",
      observedAt: new Date(state.lastMessage || ctx.now).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: rows.length,
      data: { fields: ["mmsi", "name", "lon", "lat", "sog_kn", "cog_deg", "heading_deg", "nav_status", "observed_at"], rows },
      attribution: this.attribution,
      notes: [
        rows.length === 0 ? "Stream connecting — vessels appear as position reports arrive (usually within a minute)." : `Vessels reporting within the last ${MAX_AGE_MS / 60_000} minutes.`,
        "Terrestrial AIS: strong near coasts, sparse in open ocean.",
      ],
    };
  },
};
