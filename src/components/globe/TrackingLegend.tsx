"use client";
/** Key for the live-tracking overlays (SHIP, MIL, SAT·ORB), shown in the legend stack. */
import type { LiveLayerResponse } from "@/lib/client/use-live-layer";
import { SHIP_COLORS, shipCategory, type ShipCategory } from "@/layers/maritime/parser";
import type { MaritimeData } from "@/layers/maritime/types";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { SatElements, SatellitesData } from "@/layers/satellites/parser";
import { MIL_COLOR, SAT_COLORS } from "./layers";

type LayerState<T> = { data: LiveLayerResponse<T> | null; error: string | null; loading: boolean };

const fmt = (n: number) => n.toLocaleString("en-US");
const SHIP_ORDER: ShipCategory[] = ["cargo", "tanker", "passenger", "fishing", "service", "pleasure", "military", "other"];

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function TrackingLegend({
  ships,
  mil,
  sats,
  selectedSat,
  onClearSat,
}: {
  ships: LayerState<MaritimeData> | null;
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
    <div className="glass pointer-events-auto w-[230px] space-y-2 rounded-md px-3 py-2 text-[11px] leading-snug">
      {ships && (
        <div>
          <div className="meta" style={{ color: "#4dd4ff" }}>
            Ships (AIS){ships.data ? ` · ${fmt(ships.data.count)}` : ""} {ships.data?.stale ? "· stale" : ""}
          </div>
          {ships.data ? (
            <>
              <div className="mt-1 grid grid-cols-2 gap-x-2 text-muted">
                {SHIP_ORDER.filter((c) => shipCounts.get(c)).map((c) => (
                  <span key={c} className="flex items-center gap-1.5">
                    <Dot color={SHIP_COLORS[c]} />
                    {c} {fmt(shipCounts.get(c) ?? 0)}
                  </span>
                ))}
              </div>
              <div className="text-faint">
                {ships.data.data.source === "digitraffic"
                  ? "Keyless Baltic feed (Fintraffic Digitraffic, CC BY 4.0). Add AISSTREAM_API_KEY for global coverage."
                  : "AISStream.io terrestrial AIS."}{" "}
                Dimmed = stationary.
              </div>
            </>
          ) : (
            <div className="text-faint">{ships.error ?? "Loading…"}</div>
          )}
        </div>
      )}
      {mil && (
        <div>
          <div className="meta" style={{ color: MIL_COLOR }}>
            Military aircraft{mil.data ? ` · ${fmt(mil.data.count)}` : ""} {mil.data?.stale ? "· stale" : ""}
          </div>
          <div className="text-faint">
            {mil.data || !mil.error
              ? "Aircraft broadcasting ADS-B identified as military in the community database (adsb.lol, ODbL). Most military flights do not broadcast."
              : mil.error}
          </div>
        </div>
      )}
      {sats && (
        <div>
          <div className="meta text-fg">Satellites{s ? ` · ${fmt(s.sats.length)}` : ""} {sats.data?.stale ? "· stale" : ""}</div>
          {s ? (
            <>
              <div className="mt-1 space-y-0.5 text-muted">
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
        </div>
      )}
    </div>
  );
}
