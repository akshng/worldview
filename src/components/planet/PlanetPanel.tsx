"use client";
/** Planet: climate and space-weather indicators from NOAA and NSIDC. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { PlanetDashboard } from "@/lib/planet";
import { useUI } from "@/lib/store/ui";
import { relativeTime } from "@/lib/time";
import { CloseIcon } from "@/components/ui/icons";
import { IndicatorGrid } from "@/components/markets/MacroDashboard";

export function PlanetPanel() {
  const open = useUI((s) => s.planetOpen);
  const setOpen = useUI((s) => s.setPlanetOpen);
  const [data, setData] = useState<PlanetDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api.planet(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 px-4 py-8" onMouseDown={() => setOpen(false)}>
      <div className="glass h-fit w-[760px] max-w-full rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Planet">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-accent">Planet</div>
            <h2 className="mt-1 text-[20px] leading-tight font-semibold tracking-tight">Climate &amp; space weather</h2>
            <p className="mt-1 text-[12px] text-muted">
              Measured indicators from NOAA and NSIDC.{data && ` Updated ${relativeTime(data.generatedAt)}.`} Hover a tile for what it measures; click for the source.
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" title="Close (Esc)" aria-label="Close planet panel">
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {!data && !err && <p className="text-[12px] text-muted">Loading…</p>}
          {data && <IndicatorGrid indicators={data.indicators} groups={["Climate", "Space weather"]} />}
          {data && data.approaches.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] text-faint">Asteroid close approaches · next 30 days (within 0.05 au)</div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] text-faint">
                    <th className="py-1 font-normal">Object</th>
                    <th className="py-1 font-normal">Closest approach (UTC)</th>
                    <th className="py-1 text-right font-normal" title="Lunar distances: 1 LD ≈ 384,400 km">Distance</th>
                    <th className="py-1 text-right font-normal">Speed</th>
                    <th className="py-1 text-right font-normal" title="Estimated from brightness; true size depends on how reflective the object is">Est. size</th>
                  </tr>
                </thead>
                <tbody>
                  {data.approaches.map((a) => (
                    <tr key={a.designation + a.when} className="border-t border-line">
                      <td className="py-1">
                        <a className="hover:text-accent" href={`https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(a.designation)}`} target="_blank" rel="noreferrer">{a.designation}</a>
                      </td>
                      <td className="tabular py-1 text-muted">{a.when}</td>
                      <td className="tabular py-1 text-right" title={`${a.distanceKm.toLocaleString("en-US")} km`}>{a.distanceLd} LD</td>
                      <td className="tabular py-1 text-right text-muted">{a.velocityKms} km/s</td>
                      <td className="tabular py-1 text-right text-muted">{a.sizeM ? `${a.sizeM[0]}–${a.sizeM[1]} m` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10.5px] text-faint">NASA JPL Small-Body Database close-approach data. Distances are nominal predictions; impact-risk assessments are published separately by NASA JPL Sentry.</p>
            </div>
          )}
          {data && data.failed.length > 0 && <p className="text-[11px] text-warn">Unavailable right now: {data.failed.join(", ")}</p>}
          <p className="text-[10.5px] text-faint">
            Sources: NOAA Global Monitoring Laboratory (CO₂), NOAA NCEI (global temperature), NSIDC Sea Ice Index, NOAA Climate Prediction Center (ONI), NOAA Space Weather
            Prediction Center (Kp, scales). Each tile states what its change compares against.
          </p>
        </div>
      </div>
    </div>
  );
}
