"use client";
/**
 * "Shaking & impact" for USGS earthquakes: ShakeMap peak intensity (with a
 * toggle that draws the intensity contours on the globe), PAGER alert level,
 * estimated fatalities / losses and population exposure, DYFI reports and the
 * tsunami flag. All facts from USGS, each linking to its USGS page. Renders
 * nothing when the event has no USGS products.
 */
import { useEffect } from "react";
import { SafeLink, SectionTitle } from "@/components/ui/primitives";
import { ExternalIcon } from "@/components/ui/icons";
import { useEnrich, useShakeOverlay } from "@/lib/enrich/client";
import { formatPagerRange, hasImpactData, mmiColor, mmiRoman, mmiShaking, type EarthquakeContext, type PagerLevel } from "@/lib/enrich/usgs";

const PAGER_COLORS: Record<PagerLevel, string> = { green: "#3fb950", yellow: "#e3c33f", orange: "#f0883e", red: "#e5534b" };

const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : n.toLocaleString("en-US");

export function ShakingImpact({ eventId, usgsId }: { eventId: string; usgsId: string }) {
  const { data } = useEnrich<{ context: EarthquakeContext | null }>(`/api/enrich/earthquake?id=${encodeURIComponent(usgsId)}`);
  const overlayFor = useShakeOverlay((s) => s.eventId);
  const overlayLoading = useShakeOverlay((s) => s.loading);
  const overlayError = useShakeOverlay((s) => s.error);
  const overlayOn = overlayFor === eventId;

  // Closing the panel / switching events turns the overlay off.
  useEffect(
    () => () => {
      if (useShakeOverlay.getState().eventId === eventId) useShakeOverlay.getState().clear();
    },
    [eventId],
  );

  const c = data?.context;
  if (!hasImpactData(c)) return null;
  const sm = c.shakemap;
  const pager = c.pager;
  const exposure = pager?.exposure.filter((r) => r.mmi >= 4).slice(0, 5) ?? [];

  return (
    <section className="border-t border-line px-4 py-3.5" data-enrich-shaking>
      <SectionTitle right={<span className="meta text-live/80">USGS</span>}>Shaking &amp; impact</SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        {pager?.level && (
          <span
            className="rounded px-1.5 py-[2px] text-[11px] font-semibold uppercase tracking-[0.04em] text-black"
            style={{ background: PAGER_COLORS[pager.level] }}
            title="USGS PAGER alert level — the higher of the estimated-fatality and economic-loss alerts"
          >
            PAGER {pager.level}
          </span>
        )}
        {sm?.maxMmi !== null && sm?.maxMmi !== undefined && (
          <span className="flex items-center gap-1.5 rounded border border-line px-1.5 py-[2px] text-[11.5px]" title="Highest Modified Mercalli Intensity in the USGS ShakeMap">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: mmiColor(sm.maxMmi) }} />
            Max intensity {mmiRoman(sm.maxMmi)} · {mmiShaking(sm.maxMmi).toLowerCase()} shaking
          </span>
        )}
        {c.tsunamiFlag && (
          <span
            className="rounded border border-warn/40 px-1.5 py-[2px] text-[11px] text-warn"
            title="USGS sets this flag for large events in oceanic regions. It is not a tsunami warning — check tsunami.gov and local authorities."
          >
            Tsunami flag (not a warning)
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        {pager?.fatalities?.likely && (
          <div>
            <dt className="meta text-faint">Est. fatalities</dt>
            <dd className="tabular mt-0.5" title={`Most likely PAGER range (${Math.round(pager.fatalities.likely.probability * 100)}% probability)`}>
              {formatPagerRange(pager.fatalities.likely, "people")}{" "}
              <span className="text-[11px] text-faint">({Math.round(pager.fatalities.likely.probability * 100)}%)</span>
            </dd>
          </div>
        )}
        {pager?.losses?.likely && (
          <div>
            <dt className="meta text-faint">Est. losses (US$)</dt>
            <dd className="tabular mt-0.5" title={`Most likely PAGER range (${Math.round(pager.losses.likely.probability * 100)}% probability)`}>
              {formatPagerRange(pager.losses.likely, "usd_millions")}{" "}
              <span className="text-[11px] text-faint">({Math.round(pager.losses.likely.probability * 100)}%)</span>
            </dd>
          </div>
        )}
        {c.dyfi && (
          <div>
            <dt className="meta text-faint">Did You Feel It?</dt>
            <dd className="tabular mt-0.5">
              {c.dyfi.responses !== null ? `${c.dyfi.responses.toLocaleString("en-US")} reports` : "—"}
              {c.dyfi.maxCdi !== null && c.dyfi.maxCdi > 0 ? ` · max ${mmiRoman(c.dyfi.maxCdi)}` : ""}
            </dd>
          </div>
        )}
        {sm?.status && (
          <div>
            <dt className="meta text-faint">ShakeMap</dt>
            <dd className="mt-0.5 capitalize">{sm.status}</dd>
          </div>
        )}
      </dl>

      {exposure.length > 0 && (
        <div className="mt-3">
          <div className="meta text-faint">Population exposed (PAGER est.)</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {exposure.map((r) => (
              <li key={r.mmi} className="flex items-center gap-1 rounded border border-line px-1.5 py-[1px] text-[11.5px]" title={`${r.population.toLocaleString("en-US")} people at intensity ${mmiRoman(r.mmi)} (${mmiShaking(r.mmi).toLowerCase()})`}>
                <span className="h-2 w-2 rounded-sm" style={{ background: mmiColor(r.mmi) }} />
                {mmiRoman(r.mmi)} <span className="tabular text-muted">{compact(r.population)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sm?.hasContours && (
        <button
          onClick={() => (overlayOn ? useShakeOverlay.getState().clear() : useShakeOverlay.getState().show(eventId, usgsId))}
          aria-pressed={overlayOn}
          className={`mt-3 rounded border px-2.5 py-1 text-[12px] ${overlayOn ? "border-accent bg-accent/20 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg"}`}
          data-shakemap-toggle
        >
          {overlayOn ? (overlayLoading ? "Loading shaking…" : "Hide shaking on map") : "Show shaking on map"}
        </button>
      )}
      {overlayOn && overlayError && <p className="mt-1 text-[11.5px] text-danger">{overlayError}</p>}
      {overlayOn && !overlayLoading && !overlayError && (
        <p className="mt-1.5 text-[11px] text-faint">Lines are ShakeMap intensity contours (Roman numerals = MMI); colours follow the USGS scale.</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
        {sm && <UsgsLink href={sm.pageUrl}>ShakeMap</UsgsLink>}
        {pager && <UsgsLink href={pager.pageUrl}>PAGER</UsgsLink>}
        {c.dyfi && <UsgsLink href={c.dyfi.pageUrl}>DYFI</UsgsLink>}
        <UsgsLink href={c.eventUrl}>Event page</UsgsLink>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
        PAGER figures are USGS model estimates with wide uncertainty (shown: most likely range and its probability); they update as data arrive.
      </p>
    </section>
  );
}

function UsgsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <SafeLink href={href} className="group inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <ExternalIcon width={11} height={11} className="opacity-60 group-hover:opacity-100" />
    </SafeLink>
  );
}
