/**
 * AIS vessel positions.
 *
 * Always merged (keyless, official):
 *  - Fintraffic Digitraffic marine (HTTP, CC BY 4.0) — Finnish receivers, northern Baltic.
 *  - Kystverket open AIS (raw NMEA over TCP, NLOD) — Norwegian coast, North Sea edge, Barents Sea, Svalbard.
 *
 * With AISSTREAM_API_KEY, AISStream.io (global terrestrial AIS, websocket) is
 * merged on top. The SHIP overlay additionally loads Open Waters AIS around the
 * current view (see ./viewport.ts), so ships show worldwide without a key.
 *
 * Streams are kept open only while the layer is being viewed (closed after 10
 * idle minutes); the latest position and static data per vessel are served from
 * memory, and a short trail per vessel is kept for the detail panel.
 */
import { connect as tcpConnect, type Socket } from "node:net";
import { httpGet } from "@/data-sources/types";
import type { LayerContext, LayerSnapshot, LiveLayerProvider } from "../types";
import { TrailStore } from "../trails";
import { digitrafficStatic, navStatusLabel, parseAisMessage, parseAisStatic, parseDigitraffic } from "./parser";
import { aisDimensions, etaFromParts, mmsiInfo, shipTypeLabel } from "./mid";
import { AivdmDecoder } from "./nmea";
import type { AisStreamMessage, DigitrafficLocations, DigitrafficVessel, MaritimeData, VesselDetail, VesselRow, VesselStatic } from "./types";

const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const MAX_VESSELS = 40_000;
const MAX_AGE_MS = 30 * 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;

interface Store {
  /** Latest position row per MMSI, per stream feed */
  aisstream: Map<number, VesselRow>;
  kystverket: Map<number, VesselRow>;
  /** Latest rows seen from viewport feeds (Open Waters), for the detail panel */
  other: Map<number, VesselRow>;
  /** Static / voyage data per MMSI from any feed */
  statics: Map<number, VesselStatic>;
  /** Where each vessel's latest position came from */
  sourceOf: Map<number, string>;
  trails: TrailStore;
}
const g = globalThis as unknown as { __worldviewVessels?: Store };
const store: Store = (g.__worldviewVessels ??= {
  aisstream: new Map(),
  kystverket: new Map(),
  other: new Map(),
  statics: new Map(),
  sourceOf: new Map(),
  trails: new TrailStore(16, 45 * 60_000, 80_000, 20_000),
});

function capMap(m: Map<number, VesselRow>) {
  if (m.size <= MAX_VESSELS) return;
  const oldest = [...m.values()].sort((a, b) => a[8] - b[8]).slice(0, MAX_VESSELS / 10);
  for (const v of oldest) m.delete(v[0]);
}

function mergeStatic(mmsi: number, s: VesselStatic) {
  const prev = store.statics.get(mmsi) ?? {};
  const next: VesselStatic = { ...prev };
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== "") (next as Record<string, unknown>)[k] = v;
  store.statics.set(mmsi, next);
  if (store.other?.size > MAX_VESSELS * 2) store.other.clear();
  if (store.statics.size > MAX_VESSELS * 2) store.statics.delete(store.statics.keys().next().value!);
}

function recordPosition(feed: "aisstream" | "kystverket", row: VesselRow) {
  const m = store[feed];
  const prev = m.get(row[0]);
  // Name / type / destination come from static messages: carry them onto the row.
  const st = store.statics.get(row[0]);
  if (st) {
    row[1] = row[1] || st.name || "";
    row[9] = row[9] ?? st.shipType ?? null;
    row[10] = row[10] ?? st.destination ?? null;
  } else if (prev) {
    row[1] = row[1] || prev[1];
  }
  m.set(row[0], row);
  store.sourceOf.set(row[0], feed);
  store.trails.add(`ship:${row[0]}`, row[2], row[3], row[8]);
  capMap(m);
}

// ---- AISStream.io (keyed, global) --------------------------------------------

interface StreamState {
  ws: WebSocket | null;
  lastRequest: number;
  lastMessage: number;
  error: string | null;
  idleTimer: NodeJS.Timeout | null;
}
const gs = globalThis as unknown as { __worldviewAis?: StreamState };
const state: StreamState = (gs.__worldviewAis ??= { ws: null, lastRequest: 0, lastMessage: 0, error: null, idleTimer: null });

function connect(apiKey: string) {
  if (state.ws && state.ws.readyState <= 1) return;
  state.error = null;
  const ws = new WebSocket(STREAM_URL);
  state.ws = ws;
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
      }),
    );
  ws.onmessage = async (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      const msg = JSON.parse(text);
      if (msg?.error) {
        state.error = String(msg.error);
        return;
      }
      state.lastMessage = Date.now();
      const st = parseAisStatic(msg as AisStreamMessage);
      if (st) return mergeStatic(st.mmsi, st.data);
      const row = parseAisMessage(msg as AisStreamMessage);
      if (row) recordPosition("aisstream", row);
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

// ---- keyless: Kystverket open AIS (Norway), raw NMEA over TCP -----------------

export const KYSTVERKET_ATTRIBUTION = "AIS: Norwegian Coastal Administration (Kystverket), NLOD";
const KV_HOST = "153.44.253.27";
const KV_PORT = 5631;

interface KvState {
  sock: Socket | null;
  lastRequest: number;
  lastMessage: number;
  error: string | null;
  /** No reconnect attempts before this time (after a failure) */
  retryAt: number;
  idleTimer: NodeJS.Timeout | null;
}
const gk = globalThis as unknown as { __worldviewKv?: KvState };
const kv: KvState = (gk.__worldviewKv ??= { sock: null, lastRequest: 0, lastMessage: 0, error: null, retryAt: 0, idleTimer: null });

function connectKystverket(now: number) {
  kv.lastRequest = now;
  if (kv.sock || now < kv.retryAt) return;
  const decoder = new AivdmDecoder();
  const sock = tcpConnect({ host: KV_HOST, port: KV_PORT, timeout: 30_000 });
  kv.sock = sock;
  let buf = "";
  sock.setEncoding("latin1");
  sock.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    if (buf.length > 10_000) buf = "";
    const t = Date.now();
    kv.lastMessage = t;
    kv.error = null;
    for (const line of lines) {
      const m = decoder.line(line, t);
      if (!m) continue;
      if (m.kind === "static") {
        mergeStatic(m.mmsi, {
          name: m.name || undefined,
          imo: m.imo,
          callSign: m.callSign || undefined,
          shipType: m.shipType,
          destination: m.destination || undefined,
          eta: m.eta ? etaFromParts(m.eta.month, m.eta.day, m.eta.hour, m.eta.minute, t) : undefined,
          draughtM: m.draughtM,
          ...(m.dims ? aisDimensions(...m.dims) : {}),
          updatedAt: t,
        });
        continue;
      }
      if (m.name || m.shipType || m.dims) mergeStatic(m.mmsi, { name: m.name || undefined, shipType: m.shipType, ...(m.dims ? aisDimensions(...m.dims) : {}), updatedAt: t });
      recordPosition("kystverket", [m.mmsi, "", Math.round(m.lon * 1e4) / 1e4, Math.round(m.lat * 1e4) / 1e4, m.sog, m.cog, m.heading, m.navStatus, t, null, null]);
    }
  });
  const fail = (msg: string) => {
    kv.error = msg;
    kv.retryAt = Date.now() + 5 * 60_000;
    sock.destroy();
  };
  sock.on("timeout", () => fail("Kystverket AIS stream timed out"));
  sock.on("error", (e) => fail(`Kystverket AIS stream: ${e.message}`));
  sock.on("close", () => {
    if (kv.sock === sock) kv.sock = null;
  });
  sock.unref();
  if (!kv.idleTimer) {
    kv.idleTimer = setInterval(() => {
      if (Date.now() - kv.lastRequest > IDLE_CLOSE_MS) {
        kv.sock?.destroy();
        kv.sock = null;
      }
    }, 60_000);
    kv.idleTimer.unref?.();
  }
}

// ---- keyless: Fintraffic Digitraffic marine (Finland / Baltic Sea) -------------

const DT_BASE = "https://meri.digitraffic.fi/api/ais/v1";
const DT_META_TTL_MS = 30 * 60_000;
const DT_MAX_AGE_MS = 60 * 60_000;
export const DIGITRAFFIC_ATTRIBUTION = "AIS: Fintraffic / digitraffic.fi, CC BY 4.0";

const gm = globalThis as unknown as { __worldviewDtMeta?: { rows: DigitrafficVessel[]; fetchedAt: number } };
const dtMeta = (gm.__worldviewDtMeta ??= { rows: [], fetchedAt: 0 });

async function loadDigitrafficRows(ctx: LayerContext): Promise<{ rows: VesselRow[]; observedAt: string | null }> {
  // Digitraffic asks every client to identify itself with a Digitraffic-User header.
  const headers = { "Digitraffic-User": "WorldView/0.1", "Accept-Encoding": "gzip" };
  const metaDue = ctx.now - dtMeta.fetchedAt > DT_META_TTL_MS;
  // Positions and metadata in parallel; `from` limits positions to the last hour (default is 24 h).
  const [loc] = await Promise.all([
    httpGet(`${DT_BASE}/locations?from=${ctx.now - DT_MAX_AGE_MS}`, ctx, { headers }).then((r) => r.json() as Promise<DigitrafficLocations>),
    metaDue
      ? httpGet(`${DT_BASE}/vessels`, ctx, { headers })
          .then((r) => r.json() as Promise<DigitrafficVessel[]>)
          .then((rows) => {
            if (!Array.isArray(rows)) return;
            Object.assign(dtMeta, { rows, fetchedAt: ctx.now });
            for (const v of rows) if (typeof v?.mmsi === "number") mergeStatic(v.mmsi, digitrafficStatic(v, ctx.now));
          })
          .catch(() => {
            /* metadata is optional: positions still render without names/types */
          })
      : Promise.resolve(),
  ]);
  const rows = parseDigitraffic(loc, dtMeta.rows, DT_MAX_AGE_MS, ctx.now);
  for (const r of rows) {
    store.trails.add(`ship:${r[0]}`, r[2], r[3], r[8]);
    store.sourceOf.set(r[0], "digitraffic");
  }
  return { rows, observedAt: loc.dataUpdatedTime ?? null };
}

async function loadMerged(ctx: LayerContext): Promise<LayerSnapshot<MaritimeData>> {
  const key = ctx.env.AISSTREAM_API_KEY;
  if (key) {
    state.lastRequest = ctx.now;
    connect(key);
  }
  connectKystverket(ctx.now);
  let dtError: string | null = null;
  const dt = await loadDigitrafficRows(ctx).catch((e: unknown) => {
    dtError = e instanceof Error ? e.message : String(e);
    return { rows: [] as VesselRow[], observedAt: null };
  });
  const cutoff = ctx.now - MAX_AGE_MS;
  const byMmsi = new Map<number, VesselRow>();
  for (const r of dt.rows) byMmsi.set(r[0], r);
  let kvCount = 0;
  for (const r of store.kystverket.values()) {
    if (r[8] < cutoff) continue;
    kvCount++;
    const prev = byMmsi.get(r[0]);
    if (!prev || prev[8] < r[8]) byMmsi.set(r[0], r);
  }
  let asCount = 0;
  if (key) {
    for (const r of store.aisstream.values()) {
      if (r[8] < cutoff) continue;
      asCount++;
      const prev = byMmsi.get(r[0]);
      if (!prev || prev[8] < r[8]) byMmsi.set(r[0], r);
    }
  }
  if (!byMmsi.size && dtError) throw new Error(dtError);
  const rows = [...byMmsi.values()];
  const kvState = kv.sock && kv.lastMessage ? null : kv.error ?? (kv.sock ? "connecting…" : null);
  return {
    layerId: "maritime",
    observedAt: dt.observedAt ?? new Date(ctx.now).toISOString(),
    retrievedAt: new Date(ctx.now).toISOString(),
    count: rows.length,
    data: {
      fields: FIELDS,
      rows,
      source: key ? "aisstream" : "keyless",
      feeds: [
        ...(key
          ? [{ id: "aisstream", name: "AISStream.io", area: "worldwide (terrestrial)", count: asCount, error: state.error ?? (asCount ? null : "connecting…") }]
          : []),
        { id: "digitraffic", name: "Fintraffic Digitraffic", area: "northern Baltic (Finland)", count: dt.rows.length, error: dtError },
        { id: "kystverket", name: "Kystverket open AIS", area: "Norwegian coast & Svalbard", count: kvCount, error: kvState },
      ],
    },
    attribution: `${key ? "AISStream.io · " : ""}${DIGITRAFFIC_ATTRIBUTION} · ${KYSTVERKET_ATTRIBUTION}`,
    notes: [
      key
        ? "AISStream.io global terrestrial AIS merged with the keyless Fintraffic (Baltic) and Kystverket (Norway) feeds."
        : "Keyless regional feeds: northern Baltic (Fintraffic) and the Norwegian coast (Kystverket). Set AISSTREAM_API_KEY for global terrestrial AIS.",
      `Vessels reporting within the last ${DT_MAX_AGE_MS / 60_000} minutes (Baltic) / ${MAX_AGE_MS / 60_000} minutes (Norway).`,
    ],
  };
}

const FIELDS = ["mmsi", "name", "lon", "lat", "sog_kn", "cog_deg", "heading_deg", "nav_status", "observed_at", "ship_type", "destination"];

export const maritimeLayer: LiveLayerProvider<MaritimeData> = {
  id: "maritime",
  name: "Vessels (AIS)",
  description:
    "Live AIS ship positions. With a free AISSTREAM_API_KEY: the global AISStream.io terrestrial network; without one: the keyless Fintraffic Digitraffic (Baltic) and Kystverket (Norway) feeds.",
  homepage: "https://www.digitraffic.fi/en/marine-traffic/",
  attribution: `AIS data © AISStream.io, or ${DIGITRAFFIC_ATTRIBUTION} and ${KYSTVERKET_ATTRIBUTION}`,
  ttlMs: 30_000,
  load: loadMerged,
};

/** Record vessels from another feed (Open Waters viewport cells) so details, flags and trails work for them too. */
export function ingestVessels(items: Array<{ row: VesselRow; static: VesselStatic; source: string }>) {
  store.other ??= new Map();
  for (const it of items) {
    mergeStatic(it.row[0], it.static);
    store.other.set(it.row[0], it.row);
    store.trails.add(`ship:${it.row[0]}`, it.row[2], it.row[3], it.row[8]);
    store.sourceOf.set(it.row[0], `openwaters:${it.source}`);
  }
}

const SOURCE_NAMES: Record<string, string> = {
  "openwaters:aishub": "Open Waters AIS via AISHub",
  "openwaters:aisstream": "Open Waters AIS via aisstream.io",
  "openwaters:station": "Open Waters AIS (volunteer receiver)",
  "openwaters:udp": "Open Waters AIS (volunteer receiver)",
  digitraffic: "Fintraffic Digitraffic (CC BY 4.0)",
  kystverket: "Kystverket open AIS (NLOD)",
  aisstream: "AISStream.io",
};

/**
 * Everything known about one vessel: latest position (from `row` — the client's
 * copy — or the stream stores), static/voyage data, flag from the MMSI and its
 * recent trail.
 */
export function vesselDetail(mmsi: number, row: VesselRow | null = null, now = Date.now()): VesselDetail {
  const r = row ?? store.aisstream.get(mmsi) ?? store.kystverket.get(mmsi) ?? store.other?.get(mmsi) ?? null;
  const st = store.statics.get(mmsi) ?? {};
  const info = mmsiInfo(mmsi);
  const shipType = st.shipType ?? r?.[9] ?? null;
  const name = st.name || r?.[1] || undefined;
  const links = [
    { label: "MarineTraffic", url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}` },
    { label: "VesselFinder", url: st.imo ? `https://www.vesselfinder.com/vessels/details/${st.imo}` : `https://www.vesselfinder.com/vessels?name=${mmsi}` },
  ];
  return {
    ...st,
    name,
    shipType,
    destination: st.destination ?? r?.[10] ?? undefined,
    mmsi,
    mmsiKind: info.kind,
    flag: { code: info.country, name: info.countryName },
    shipTypeLabel: shipTypeLabel(shipType),
    lon: r?.[2] ?? null,
    lat: r?.[3] ?? null,
    sog: r?.[4] ?? null,
    cog: r?.[5] ?? null,
    heading: r?.[6] ?? null,
    navStatus: r?.[7] ?? null,
    navStatusLabel: navStatusLabel(r?.[7]),
    observedAt: r?.[8] ?? null,
    source: SOURCE_NAMES[store.sourceOf.get(mmsi) ?? ""] ?? (store.sourceOf.get(mmsi)?.startsWith("openwaters") ? "Open Waters AIS" : "AIS"),
    trail: store.trails.get(`ship:${mmsi}`, now),
    links,
  };
}
