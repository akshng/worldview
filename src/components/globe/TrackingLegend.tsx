"use client";
/** Key for the live-tracking overlays (SHIP, AIR, MIL, SAT·ORB), shown in the legend stack. */
import type { LiveLayerResponse } from "@/lib/client/use-live-layer";
import { SHIP_COLORS, shipCategory, type ShipCategory } from "@/layers/maritime/parser";
import type { MaritimeData } from "@/layers/maritime/types";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { SatElements, SatellitesData } from "@/layers/satellites/parser";
import type { AircraftData } from "@/layers/aircraft/parser";
import { LegendCard } from "./LegendCard";
import { AIR_ALT_STOPS_FT, AIR_GROUND_COLOR, MIL_COLOR, SAT_COLORS } from "./layers";

type LayerState<T> = {
  data: LiveLayerResponse<T> | null;
  error: string | null;
  loading: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const SHIP_ORDER: ShipCategory[] = ["cargo", "tanker", "passenger", "fishing", "service", "pleasure", "military", "other"];

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

type AirState = {
  data: {
    count: number;
    data: AircraftData;
    truncated: boolean;
    capped: boolean;
    errors: string[];
  } | null;
  error: string | null;
  loading: boolean;
};

export function TrackingLegend({
  ships,
  air,
  mil,
  sats,
  selectedSat,
  onClearSat,
}: {
  ships: {
    data: {
      count: number;
      stale?: boolean;
      keyed?: boolean;
      truncated?: boolean;
      data: MaritimeData;
    } | null;
    error: string | null;
    loading: boolean;
  } | null;
  air: AirState | null;
  mil: LayerState<MilitaryAircraftData> | null;
  sats: LayerState<SatellitesData> | null;
  selectedSat: SatElements | null;
  onClearSat: () => void;
}) {
  const shipCounts = new Map<ShipCategory, number>();
  for (const r of ships?.data?.data.rows ?? []) {
    const c = shipCategory(r[9]);
    shipCounts.set(c, (shipCounts.get(c) ?? 0) + 1);
  }
  const s = sats?.data?.data;
  return (
    <>
      {ships && (
        <LegendCard id="ships" color="#4dd4ff" title={`Ships (AIS)${ships.data ? ` · ${fmt(ships.data.count)}` : ""}${ships.data?.stale ? " · stale" : ""}`}>
          {ships.data ? (
            <>
              <div className="grid grid-cols-2 gap-x-2 text-muted">
                {SHIP_ORDER.filter((c) => shipCounts.get(c)).map((c) => (
                  <span key={c} className="flex items-center gap-1.5">
                    <Dot color={SHIP_COLORS[c]} />
                    {c} {fmt(shipCounts.get(c) ?? 0)}
                  </span>
                ))}
              </div>
              <div className="space-y-0.5 text-muted">
                {(ships.data.data.feeds ?? []).map((f) => (
                  <div key={f.id} className="flex justify-between gap-2" title={f.error ?? f.area}>
                    <span className="truncate">{f.name}</span>
                    <span className="tabular shrink-0 text-faint">
                      {f.error && !f.count ? (f.error === "connecting…" ? "connecting…" : "unavailable") : fmt(f.count)}
                    </span>
                  </div>
                ))}
              </div>
              {ships.data.truncated && <div className="text-faint">Wide view: the busiest sea areas are loaded — zoom in for everything in view.</div>}
              {(ships.data.keyed === false || ships.data.data.source === "keyless") && (
                <details className="mt-1 rounded border border-line px-1.5 py-1">
                  <summary className="cursor-pointer text-fg">Add a free AISStream key for worldwide ships</summary>
                  <div className="mt-1 text-faint">
                    Sign up at{" "}
                    <a className="text-accent hover:underline" href="https://aisstream.io/authenticate" target="_blank" rel="noopener noreferrer">
                      aisstream.io
                    </a>{" "}
                    (free), put <code className="text-muted">AISSTREAM_API_KEY=your-key</code> in <code className="text-muted">.env.local</code> and restart.
                    Its global stream is merged with the keyless feeds.
                  </div>
                </details>
              )}
              <div className="text-faint">Dimmed = stationary. Click a ship for details.</div>
            </>
          ) : (
            <div className="text-faint">{ships.error ?? "Loading…"}</div>
          )}
        </LegendCard>
      )}
      {air && (
        <LegendCard id="air" color="#4dabf7" title={`Aircraft${air.data ? ` · ${fmt(air.data.count)}` : ""}`}>
          {air.data || !air.error ? (
            <>
              <div className="flex h-2 overflow-hidden rounded-full" aria-label="Altitude from ground (yellow) to 38,000 ft (violet)">
                {AIR_ALT_STOPS_FT.map(([v, c]) => (
                  <span key={v} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="meta flex justify-between normal-case tracking-normal text-faint">
                <span>0 ft</span>
                <span>10k</span>
                <span>26k</span>
                <span>38k+</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted">
                <Dot color={AIR_GROUND_COLOR} /> on ground
              </div>
              <div className="text-faint">
                {air.data?.truncated ? "Wide view: only the busiest areas are loaded — zoom in to see everything in view. " : ""}
                {air.data?.capped ? "Showing the nearest 5,000. " : ""}
                adsb.lol volunteer receivers (ODbL), refreshed every 15–25 s. Click a plane for details.
              </div>
            </>
          ) : (
            <div className="text-faint">{air.error}</div>
          )}
        </LegendCard>
      )}
      {mil && (
        <LegendCard id="mil" color={MIL_COLOR} title={`Military aircraft${mil.data ? ` · ${fmt(mil.data.count)}` : ""}${mil.data?.stale ? " · stale" : ""}`}>
          <div className="text-faint">
            {mil.data || !mil.error
              ? "Aircraft broadcasting ADS-B identified as military in the community database (adsb.lol, ODbL). Most military flights do not broadcast."
              : mil.error}
          </div>
        </LegendCard>
      )}
      {sats && (
        <LegendCard id="sats" title={`Satellites${s ? ` · ${fmt(s.sats.length)}` : ""}${sats.data?.stale ? " · stale" : ""}`}>
          {s ? (
            <>
              <div className="space-y-0.5 text-muted">
                <span className="flex items-center gap-1.5">
                  <Dot color={SAT_COLORS.stations} /> Space stations {s.groups.stations}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot color={SAT_COLORS.gps} /> GPS {s.groups.gps}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot color={SAT_COLORS.visual} /> Brightest {s.groups.visual}
                </span>
              </div>
              {selectedSat ? (
                <div className="mt-1 flex items-start justify-between gap-2 text-muted">
                  <span>
                    Orbit: <span className="text-fg">{selectedSat.name}</span> (past ½ orbit faint, next orbit bright)
                  </span>
                  <button onClick={onClearSat} className="text-faint hover:text-fg" aria-label="Clear selected satellite orbit" title="Clear orbit">
                    ✕
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-faint">Click a satellite to draw its orbit.</div>
              )}
              <div className="text-faint">Computed in your browser with SGP4 from CelesTrak elements — not observed.</div>
            </>
          ) : (
            <div className="text-faint">{sats.error ?? "Loading…"}</div>
          )}
        </LegendCard>
      )}
    </>
  );
}
