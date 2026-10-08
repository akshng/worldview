"use client";
/**
 * Detail panel for a live tracked object (ship, aircraft, satellite), opened by
 * clicking it on the globe. Live fields come from the data the map already
 * holds (so they update with every poll); static details and the recent trail
 * come from /api/tracks/:kind/:id.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useUI, type TrackRef } from "@/lib/store/ui";
import { useTracking } from "@/lib/client/tracking-store";
import { useNow } from "@/lib/client/use-now";
import { formatUtc, relativeTime } from "@/lib/time";
import { SafeLink, SectionTitle } from "@/components/ui/primitives";
import { CloseIcon, ExternalIcon } from "@/components/ui/icons";
import { SHIP_COLORS, navStatusLabel, shipCategory } from "@/layers/maritime/parser";
import { flagEmoji, mmsiInfo, shipTypeLabel } from "@/layers/maritime/mid";
import type { VesselDetail } from "@/layers/maritime/types";
import type { AircraftDetail } from "@/layers/aircraft";
import { airlineFromCallsign, icaoCountry, squawkMeaning, typeName } from "@/layers/aircraft/reference";
import { orbitInfo } from "@/components/globe/tracking";
import { subPoint } from "@/layers/satellites/sgp4";
import { MIL_COLOR, SAT_COLORS } from "@/components/globe/layers";

const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n)
    ? null
    : n.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const deg = (n: number | null | undefined) => (n == null ? null : `${Math.round(n)}°`);
const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="meta text-faint">{label}</dt>
      <dd className="tabular mt-0.5 text-[12.5px]">{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5">
      <SectionTitle right={right}>{title}</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</dl>
    </section>
  );
}

function Links({ links, note }: { links: Array<{ label: string; url: string }>; note?: string }) {
  return (
    <section className="border-t border-line px-4 py-3.5">
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <SafeLink
            key={l.url}
            href={l.url}
            className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[12px] text-accent hover:bg-panel-hover"
          >
            {l.label} <ExternalIcon width={11} height={11} />
          </SafeLink>
        ))}
      </div>
      {note && <p className="mt-2 text-[11.5px] leading-snug text-faint">{note}</p>}
    </section>
  );
}

/** Fetches /api/tracks detail for ships and aircraft, refreshing while open; publishes the trail to the map. */
function useTrackDetail<T>(ref: TrackRef | null, everyMs: number): { data: T | null; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const key = ref && ref.kind !== "sat" ? `${ref.kind}/${ref.id}` : "";
  useEffect(() => {
    useTracking.setState({ trail: [] });
    if (!key) return;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/tracks/${key}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setState({ key, data: body as T, error: null });
        useTracking.setState({
          trail: (body as { trail?: Array<[number, number, number]> }).trail ?? [],
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState((s) => ({ ...s, key, error: (e as Error).message }));
      }
    };
    void load();
    const t = setInterval(load, everyMs);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [key, everyMs]);
  return state.key === key ? state : { data: null, error: null };
}

export function TrackPanel() {
  const ref = useUI((s) => s.selectedTrack);
  const follow = useUI((s) => s.followTrack);
  const close = () => useUI.getState().selectTrack(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !useUI.getState().searchOpen && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ref) return null;
  const kindLabel = ref.kind === "ship" ? "Vessel" : ref.kind === "sat" ? "Satellite" : ref.mil ? "Military aircraft" : "Aircraft";
  return (
    <div
      className="glass panel-in pointer-events-auto flex max-h-full w-[400px] max-w-[calc(100vw-24px)] flex-col self-start rounded-md shadow-2xl shadow-black/50"
      role="dialog"
      aria-label={`${kindLabel} details`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="meta text-faint">{kindLabel} · live</span>
        <span className="flex-1" />
        <button
          onClick={() => useUI.getState().setFollowTrack(!follow)}
          aria-pressed={follow}
          title={follow ? "Stop following" : "Keep the map centred on this object"}
          className={`meta rounded border px-2 py-1 ${follow ? "border-accent/60 bg-accent/20 text-fg" : "border-line text-muted hover:bg-panel-hover hover:text-fg"}`}
        >
          {follow ? "Following" : "Follow"}
        </button>
        <button onClick={close} className="rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close details (Esc)" title="Close (Esc)">
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto">
        {ref.kind === "ship" ? <ShipBody id={ref.id} /> : ref.kind === "aircraft" ? <AircraftBody id={ref.id} mil={!!ref.mil} /> : <SatBody id={ref.id} />}
      </div>
    </div>
  );
}

function Header({ head, color, title, sub }: { head: string; color: string; title: string; sub?: ReactNode }) {
  return (
    <div className="px-4 pt-3.5 pb-3.5">
      <div className="meta" style={{ color }}>
        {head}
      </div>
      <h2 className="mt-1.5 text-[17px] leading-snug font-semibold break-words">{title}</h2>
      {sub && <div className="mt-1 text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}

function Gone({ what }: { what: string }) {
  return (
    <p className="mx-4 mb-3 rounded border border-warn/30 px-2 py-1.5 text-[11.5px] leading-snug text-warn">
      This {what} is not in the latest live data (out of view, out of coverage or stopped reporting). Last known details shown.
    </p>
  );
}

// ---- ships ----------------------------------------------------------------------

function ShipBody({ id }: { id: string }) {
  const now = useNow(5_000);
  const row = useTracking((s) => s.ships?.rows.find((r) => String(r[0]) === id) ?? null);
  const { data: d, error } = useTrackDetail<VesselDetail>({ kind: "ship", id }, 30_000);
  const mmsi = Number(id);
  const info = mmsiInfo(mmsi);
  const type = d?.shipType ?? row?.[9] ?? null;
  const cat = shipCategory(type);
  const name = d?.name || row?.[1] || `MMSI ${id}`;
  const lon = row?.[2] ?? d?.lon ?? null,
    lat = row?.[3] ?? d?.lat ?? null;
  const sog = row ? row[4] : (d?.sog ?? null),
    cog = row ? row[5] : (d?.cog ?? null),
    hdg = row ? row[6] : (d?.heading ?? null);
  const nav = row ? row[7] : (d?.navStatus ?? null);
  const seen = row?.[8] ?? d?.observedAt ?? null;
  const flag = info.countryName ? `${flagEmoji(info.country)} ${info.countryName}` : null;
  return (
    <>
      <Header
        head={`Vessel${cat !== "other" ? ` · ${cat}` : ""}`}
        color={SHIP_COLORS[cat]}
        title={name}
        sub={[flag, shipTypeLabel(type)].filter(Boolean).join(" · ") || "AIS station"}
      />
      {!row && d && <Gone what="vessel" />}
      {error && !d && <p className="px-4 pb-3 text-[12px] text-danger">{error}</p>}
      <Section title="Movement" right={seen ? <span className="meta text-faint">{relativeTime(seen, now)}</span> : null}>
        <Field label="Speed">{sog != null ? `${fmt(sog, 1)} kn · ${fmt(sog * 1.852, 1)} km/h` : null}</Field>
        <Field label="Course / heading">{cog != null || hdg != null ? `${deg(cog) ?? "—"} / ${deg(hdg) ?? "—"}` : null}</Field>
        <Field label="Navigation status">{navStatusLabel(nav)}</Field>
        <Field label="Last report">{seen ? formatUtc(seen) : null}</Field>
        <Field label="Position" wide>
          {lat != null && lon != null ? coord(lat, lon) : null}
        </Field>
      </Section>
      <Section title="Voyage">
        <Field label="Destination">{d?.destination || row?.[10] || null}</Field>
        <Field label="ETA">{d?.eta ? formatUtc(d.eta) : null}</Field>
        <Field label="Draught">{d?.draughtM != null ? `${fmt(d.draughtM, 1)} m` : null}</Field>
      </Section>
      <Section title="Vessel">
        <Field label="MMSI">{id}</Field>
        <Field label="IMO">{d?.imo ?? null}</Field>
        <Field label="Call sign">{d?.callSign ?? null}</Field>
        <Field label="Flag (from MMSI)">{flag}</Field>
        <Field label="Type">
          {shipTypeLabel(type)}
          {type != null ? <span className="text-faint"> ({type})</span> : null}
        </Field>
        <Field label="Length × beam">{d?.lengthM || d?.beamM ? `${d?.lengthM ?? "—"} × ${d?.beamM ?? "—"} m` : null}</Field>
      </Section>
      <Links
        links={
          d?.links ?? [
            {
              label: "MarineTraffic",
              url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${id}`,
            },
          ]
        }
        note={`${(d?.trail?.length ?? 0) > 1 ? `Dashed line: last ${d!.trail.length} reported positions. ` : ""}Source: ${d?.source ?? "AIS"}. Static data is self-reported by the ship and can be wrong or stale.`}
      />
    </>
  );
}

// ---- aircraft ----------------------------------------------------------------------

function AircraftBody({ id, mil }: { id: string; mil: boolean }) {
  const now = useNow(5_000);
  const row = useTracking(
    (s) => (mil ? s.mil?.rows.find((r) => r[0] === id) : null) ?? s.aircraft?.rows.find((r) => r[0] === id) ?? s.mil?.rows.find((r) => r[0] === id) ?? null,
  );
  const { data: d, error } = useTrackDetail<AircraftDetail>({ kind: "aircraft", id }, 15_000);
  const callsign = row?.[1] || d?.callsign || null;
  const reg = row?.[2] || d?.registration || null;
  const tcode = row?.[3] || d?.typeCode || null;
  const model = d?.typeName ?? typeName(tcode);
  const operator = d?.operator ?? airlineFromCallsign(callsign);
  const country = d?.country ?? icaoCountry(id);
  const isMil = mil || !!d?.military || (row && row.length > 12 ? !!(row as unknown[])[12] : false);
  const onGround = row ? row[7] : !!d?.onGround;
  const alt = row ? row[6] : (d?.altBaroFt ?? null);
  const gs = row ? row[8] : (d?.gsKt ?? null);
  const track = row ? row[9] : (d?.trackDeg ?? null);
  const squawk = row?.[10] || d?.squawk || null;
  const lon = row?.[4] ?? d?.lon ?? null,
    lat = row?.[5] ?? d?.lat ?? null;
  const seenAt = d?.observedAt ?? null;
  const vr = d?.vertRateFpm ?? null;
  return (
    <>
      <Header
        head={isMil ? "Military-flagged aircraft (ADS-B)" : "Aircraft (ADS-B)"}
        color={isMil ? MIL_COLOR : "#4dabf7"}
        title={callsign || reg || id.toUpperCase()}
        sub={[model ?? tcode, operator].filter(Boolean).join(" · ") || undefined}
      />
      {!row && d && <Gone what="aircraft" />}
      {error && !d && <p className="px-4 pb-3 text-[12px] text-danger">{error}</p>}
      {(squawkMeaning(squawk) && ["7500", "7600", "7700"].includes(squawk ?? "")) || d?.emergency ? (
        <p className="mx-4 mb-3 rounded border border-danger/40 px-2 py-1.5 text-[12px] text-danger">
          Emergency: {d?.emergency ?? squawkMeaning(squawk)} (squawk {squawk})
        </p>
      ) : null}
      <Section title="Flight" right={seenAt ? <span className="meta text-faint">{relativeTime(seenAt, now)}</span> : null}>
        <Field label="Altitude">{onGround ? "On ground" : alt != null ? `${fmt(alt)} ft · ${fmt(alt * 0.3048)} m` : null}</Field>
        <Field label="Ground speed">{gs != null ? `${fmt(gs)} kt · ${fmt(gs * 1.852)} km/h` : null}</Field>
        <Field label="Track / heading">{track != null || d?.headingDeg != null ? `${deg(track) ?? "—"} / ${deg(d?.headingDeg) ?? "—"}` : null}</Field>
        <Field label="Vertical rate">{vr != null ? `${vr > 0 ? "+" : ""}${fmt(vr)} ft/min` : null}</Field>
        <Field label="Squawk">
          {squawk ? (
            <>
              {squawk}
              {squawkMeaning(squawk) ? <span className="text-faint"> · {squawkMeaning(squawk)}</span> : null}
            </>
          ) : null}
        </Field>
        <Field label="Selected altitude">{d?.selectedAltFt != null ? `${fmt(d.selectedAltFt)} ft` : null}</Field>
        <Field label="Position" wide>
          {lat != null && lon != null ? coord(lat, lon) : null}
        </Field>
      </Section>
      <Section title="Aircraft">
        <Field label="Callsign">{callsign}</Field>
        <Field label="Registration">{reg}</Field>
        <Field label="Type">
          {model ? (
            <>
              {model}
              {tcode ? <span className="text-faint"> ({tcode})</span> : null}
            </>
          ) : (
            tcode
          )}
        </Field>
        <Field label="Category">{d?.categoryLabel ?? null}</Field>
        <Field label="Operator">
          {operator ? (
            <>
              {operator}
              {d?.operatorSource === "callsign" ? <span className="text-faint"> (from callsign)</span> : null}
            </>
          ) : null}
        </Field>
        <Field label="Registered in">{country ? `${flagEmoji(country.code)} ${country.name}` : null}</Field>
        <Field label="ICAO address">{id.toUpperCase()}</Field>
        <Field label="Position source">{d?.positionSource ?? null}</Field>
        <Field label="Last position">{seenAt ? formatUtc(seenAt) : null}</Field>
      </Section>
      <Links
        links={
          d?.links ?? [
            {
              label: "adsb.lol track",
              url: `https://globe.adsb.lol/?icao=${id}`,
            },
          ]
        }
        note={`${(d?.trail?.length ?? 0) > 1 ? `Dashed line: last ${d!.trail.length} positions seen. ` : ""}Data: adsb.lol volunteer receivers (ODbL). "Registered in" is inferred from the ICAO address block.`}
      />
    </>
  );
}

// ---- satellites ----------------------------------------------------------------------

function SatBody({ id }: { id: string }) {
  const now = useNow(1_000);
  const sat = useTracking((s) => s.sats.find((x) => String(x.el.id) === id) ?? null);
  if (!sat) return <p className="p-6 text-[12.5px] text-muted">Satellite not in the loaded set — turn on SAT·ORB.</p>;
  const { el, rec } = sat;
  const p = subPoint(rec, now);
  const o = orbitInfo(el);
  const group = el.group === "stations" ? "Space station" : el.group === "gps" ? "GPS satellite" : "Satellite";
  return (
    <>
      <Header head={group} color={SAT_COLORS[el.group]} title={el.name} sub={`NORAD ${el.id}${el.intlDes ? ` · ${el.intlDes}` : ""}`} />
      <Section title="Now" right={<span className="meta text-faint">computed every second</span>}>
        <Field label="Altitude">{p ? `${fmt(p.altKm)} km` : null}</Field>
        <Field label="Velocity">{p ? `${fmt(p.speedKms, 2)} km/s · ${fmt(p.speedKms * 3600)} km/h` : null}</Field>
        <Field label="Position" wide>
          {p ? coord(p.lat, p.lon) : null}
        </Field>
      </Section>
      <Section title="Orbit">
        <Field label="Period">{`${fmt(o.periodMin, 1)} min`}</Field>
        <Field label="Inclination">{`${fmt(o.inclinationDeg, 2)}°`}</Field>
        <Field label="Apogee">{`${fmt(o.apogeeKm)} km`}</Field>
        <Field label="Perigee">{`${fmt(o.perigeeKm)} km`}</Field>
        <Field label="Eccentricity">{fmt(el.eccentricity, 5)}</Field>
        <Field label="Revolutions / day">{fmt(el.meanMotion, 3)}</Field>
        <Field label="Elements epoch" wide>{`${formatUtc(el.epochMs)} (${relativeTime(el.epochMs, now)})`}</Field>
      </Section>
      <Links
        links={[
          {
            label: "CelesTrak",
            url: `https://celestrak.org/satcat/table-satcat.php?CATNR=${el.id}`,
          },
          { label: "N2YO", url: `https://www.n2yo.com/satellite/?s=${el.id}` },
        ]}
        note="Positions are computed in your browser with SGP4 from CelesTrak orbital elements — a prediction, not an observation. The map shows the past half orbit and the next full orbit."
      />
    </>
  );
}
