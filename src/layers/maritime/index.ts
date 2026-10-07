/**
 * AIS vessel positions. With AISSTREAM_API_KEY: AISStream.io (global
 * terrestrial AIS). Without a key: Fintraffic Digitraffic marine (keyless,
 * CC BY 4.0, Finnish coastal receivers — Baltic Sea only).
 *
 * AISStream is a websocket stream, so this layer keeps a connection open while
 * the layer is being viewed (closing it after 10 idle minutes) and serves the
 * latest position per vessel from memory.
 */
import { httpGet } from "@/data-sources/types";
import type { LayerContext, LayerSnapshot, LiveLayerProvider } from "../types";
import { parseAisMessage, parseDigitraffic } from "./parser";
import type { AisStreamMessage, DigitrafficLocations, DigitrafficVessel, MaritimeData, VesselRow } from "./types";

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

// ---- keyless fallback: Fintraffic Digitraffic marine (Finland / Baltic Sea) ----

const DT_BASE = "https://meri.digitraffic.fi/api/ais/v1";
const DT_META_TTL_MS = 30 * 60_000;
const DT_MAX_AGE_MS = 60 * 60_000;
export const DIGITRAFFIC_ATTRIBUTION = "AIS: Fintraffic / digitraffic.fi, CC BY 4.0";

const gm = globalThis as unknown as { __worldviewDtMeta?: { rows: DigitrafficVessel[]; fetchedAt: number } };
const dtMeta = (gm.__worldviewDtMeta ??= { rows: [], fetchedAt: 0 });

async function loadDigitraffic(ctx: LayerContext): Promise<LayerSnapshot<MaritimeData>> {
  // Digitraffic asks every client to identify itself with a Digitraffic-User header.
  const headers = { "Digitraffic-User": "WorldView/0.1", "Accept-Encoding": "gzip" };
  if (ctx.now - dtMeta.fetchedAt > DT_META_TTL_MS) {
    try {
      const res = await httpGet(`${DT_BASE}/vessels`, ctx, { headers });
      const rows = (await res.json()) as DigitrafficVessel[];
      if (Array.isArray(rows)) Object.assign(dtMeta, { rows, fetchedAt: ctx.now });
    } catch {
      /* metadata is optional: positions still render without names/types */
    }
  }
  const loc = (await (await httpGet(`${DT_BASE}/locations`, ctx, { headers })).json()) as DigitrafficLocations;
  const rows = parseDigitraffic(loc, dtMeta.rows, DT_MAX_AGE_MS, ctx.now);
  return {
    layerId: "maritime",
    observedAt: loc.dataUpdatedTime ?? new Date(ctx.now).toISOString(),
    retrievedAt: new Date(ctx.now).toISOString(),
    count: rows.length,
    data: { fields: FIELDS, rows, source: "digitraffic" },
    attribution: DIGITRAFFIC_ATTRIBUTION,
    notes: [
      "Keyless regional feed: Finnish coastal AIS receivers (Gulf of Finland, Gulf of Bothnia, northern Baltic). Set AISSTREAM_API_KEY for global terrestrial AIS.",
      `Vessels reporting within the last ${DT_MAX_AGE_MS / 60_000} minutes; refreshed at most once a minute.`,
    ],
  };
}

const FIELDS = ["mmsi", "name", "lon", "lat", "sog_kn", "cog_deg", "heading_deg", "nav_status", "observed_at", "ship_type", "destination"];

export const maritimeLayer: LiveLayerProvider<MaritimeData> = {
  id: "maritime",
  name: "Vessels (AIS)",
  description:
    "Live AIS ship positions. With a free AISSTREAM_API_KEY: the global AISStream.io terrestrial network; without one: the keyless Fintraffic Digitraffic feed (Finland / Baltic Sea).",
  homepage: "https://www.digitraffic.fi/en/marine-traffic/",
  attribution: `AIS data © AISStream.io, or ${DIGITRAFFIC_ATTRIBUTION}`,
  ttlMs: 60_000,
  async load(ctx) {
    if (!ctx.env.AISSTREAM_API_KEY) return loadDigitraffic(ctx);
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
      data: { fields: FIELDS, rows, source: "aisstream" },
      attribution: "AIS data © AISStream.io",
      notes: [
        rows.length === 0 ? "Stream connecting — vessels appear as position reports arrive (usually within a minute)." : `Vessels reporting within the last ${MAX_AGE_MS / 60_000} minutes.`,
        "Terrestrial AIS: strong near coasts, sparse in open ocean.",
      ],
    };
  },
};
