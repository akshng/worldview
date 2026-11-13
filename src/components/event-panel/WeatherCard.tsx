"use client";
/**
 * Point weather (Open-Meteo): current conditions + next 24 h, sea state near
 * the coast and river discharge for floods. Used in the event panel and, in a
 * compact form, in the drop-in HUD. Fetches only while it's mounted.
 */
import { useEnrich } from "@/lib/enrich/client";
import { compass, OPEN_METEO_ATTRIBUTION, OPEN_METEO_URL, roundCoord, weatherCode, type PointWeather, type WeatherIcon } from "@/lib/enrich/weather";
import { SectionTitle } from "@/components/ui/primitives";

export function weatherUrl(lat: number, lon: number, opts: { marine?: boolean; flood?: boolean } = {}): string {
  return `/api/enrich/weather?lat=${roundCoord(lat).toFixed(2)}&lon=${roundCoord(lon).toFixed(2)}${opts.marine ? "&marine=1" : ""}${opts.flood ? "&flood=1" : ""}`;
}

const r0 = (v: number | null | undefined) => (typeof v === "number" ? Math.round(v).toString() : "—");
const r1 = (v: number | null | undefined) => (typeof v === "number" ? (Math.round(v * 10) / 10).toString() : "—");

function Attribution() {
  return (
    <a href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-accent">
      {OPEN_METEO_ATTRIBUTION}
    </a>
  );
}

/** Event-panel section. */
export function WeatherSection({ lat, lon, marine, flood }: { lat: number; lon: number; marine?: boolean; flood?: boolean }) {
  const { data, loading, error } = useEnrich<PointWeather>(weatherUrl(lat, lon, { marine, flood }));
  const f = data?.forecast;
  if (error) return null; // weather is a nice-to-have: no error box in the panel
  return (
    <section className="border-t border-line px-4 py-3.5" data-enrich-weather>
      <SectionTitle right={<span className="meta normal-case tracking-normal"><Attribution /></span>}>Weather here</SectionTitle>
      {loading && <div className="text-[12px] text-muted">Loading weather…</div>}
      {f?.now && (
        <>
          <div className="flex items-center gap-3">
            <WxIcon icon={weatherCode(f.now.code).icon} night={!f.now.isDay} size={30} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tabular">
                {r0(f.now.temperatureC)}°C <span className="text-[12.5px] font-normal text-muted">{weatherCode(f.now.code).label}</span>
              </div>
              <div className="text-[11.5px] text-muted">
                Feels {r0(f.now.feelsLikeC)}°C · humidity {r0(f.now.humidityPct)}%{f.now.precipitationMm ? ` · ${r1(f.now.precipitationMm)} mm now` : ""}
              </div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <div>
              <dt className="meta text-faint">Wind</dt>
              <dd className="tabular mt-0.5">
                {r0(f.now.windKmh)} km/h {compass(f.now.windDirDeg)}
              </dd>
            </div>
            <div>
              <dt className="meta text-faint">Gusts</dt>
              <dd className="tabular mt-0.5">{r0(f.now.gustKmh)} km/h</dd>
            </div>
            <div>
              <dt className="meta text-faint">Next 24 h</dt>
              <dd className="tabular mt-0.5">
                {r0(f.next24.minC)}–{r0(f.next24.maxC)}°C
              </dd>
            </div>
            <div>
              <dt className="meta text-faint">Rain, 24 h</dt>
              <dd className="tabular mt-0.5">
                {r1(f.next24.precipMm)} mm{typeof f.next24.maxPrecipProbPct === "number" ? ` · up to ${f.next24.maxPrecipProbPct}%` : ""}
              </dd>
            </div>
            <div>
              <dt className="meta text-faint">Peak gust, 24 h</dt>
              <dd className="tabular mt-0.5">{r0(f.next24.maxGustKmh)} km/h</dd>
            </div>
            <div>
              <dt className="meta text-faint">Worst, 24 h</dt>
              <dd className="mt-0.5">{weatherCode(f.next24.worstCode).label}</dd>
            </div>
            {data?.marine && (
              <>
                <div>
                  <dt className="meta text-faint">Waves</dt>
                  <dd className="tabular mt-0.5">
                    {r1(data.marine.waveHeightM)} m · {r0(data.marine.wavePeriodS)} s {compass(data.marine.waveDirDeg)}
                  </dd>
                </div>
                <div>
                  <dt className="meta text-faint">Max waves, 24 h</dt>
                  <dd className="tabular mt-0.5">
                    {r1(data.marine.maxWaveHeight24hM)} m{typeof data.marine.seaTempC === "number" ? ` · sea ${r0(data.marine.seaTempC)}°C` : ""}
                  </dd>
                </div>
              </>
            )}
            {data?.river && (
              <>
                <div>
                  <dt className="meta text-faint">River discharge</dt>
                  <dd className="tabular mt-0.5">
                    {r0(data.river.todayM3s)} m³/s{typeof data.river.medianM3s === "number" ? ` (median ${r0(data.river.medianM3s)})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="meta text-faint">Forecast peak</dt>
                  <dd className="tabular mt-0.5">
                    {r0(data.river.peakM3s)} m³/s{data.river.peakDate ? ` · ${data.river.peakDate.slice(5)}` : ""}
                  </dd>
                </div>
              </>
            )}
          </dl>
          <HourStrip data={data!} />
          <p className="mt-2 text-[10.5px] leading-snug text-faint">
            Model forecast for the ~5 km grid cell around {data!.lat.toFixed(2)}, {data!.lon.toFixed(2)}
            {f.timezone ? ` · times ${f.timezone}` : ""}
            {data?.river ? " · river discharge is modelled (GloFAS), not a gauge reading" : ""}.
          </p>
        </>
      )}
    </section>
  );
}

function HourStrip({ data }: { data: PointWeather }) {
  const hours = data.forecast?.hours ?? [];
  const picks = hours.filter((_, i) => i % 3 === 0).slice(0, 8);
  if (!picks.length) return null;
  return (
    <ol className="mt-3 grid grid-cols-8 gap-1 text-center" aria-label="Next 24 hours, every 3 hours">
      {picks.map((h) => {
        const hr = Number(h.time.slice(11, 13));
        return (
          <li key={h.time} className="rounded border border-line px-0.5 py-1" title={`${h.time.replace("T", " ")} · ${weatherCode(h.code).label}`}>
            <div className="meta normal-case tracking-normal text-faint">{h.time.slice(11, 13)}h</div>
            <div className="mt-0.5 flex justify-center">
              <WxIcon icon={weatherCode(h.code).icon} night={hr < 6 || hr >= 19} size={14} />
            </div>
            <div className="tabular text-[11px]">{r0(h.temperatureC)}°</div>
            <div className="tabular text-[9.5px] text-faint">{h.precipProbPct ? `${h.precipProbPct}%` : " "}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** One line for the drop-in HUD. */
export function WeatherLine({ lat, lon }: { lat: number; lon: number }) {
  const { data } = useEnrich<PointWeather>(weatherUrl(lat, lon));
  const f = data?.forecast;
  if (!f?.now) return null;
  const wc = weatherCode(f.now.code);
  const full =
    `${r0(f.now.temperatureC)}°C ${wc.label} (feels ${r0(f.now.feelsLikeC)}°C) · wind ${r0(f.now.windKmh)} km/h ${compass(f.now.windDirDeg)}, gusts ${r0(f.now.gustKmh)} km/h · ` +
    `next 24 h ${r0(f.next24.minC)}–${r0(f.next24.maxC)}°C, ${r1(f.next24.precipMm)} mm rain, peak gust ${r0(f.next24.maxGustKmh)} km/h` +
    (data?.marine ? ` · waves ${r1(data.marine.waveHeightM)} m, ${r0(data.marine.wavePeriodS)} s` : "");
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted" data-dropin-weather>
      <WxIcon icon={wc.icon} night={!f.now.isDay} size={14} />
      <span className="truncate" title={full}>
        <span className="tabular text-fg">{r0(f.now.temperatureC)}°C</span> {wc.label} · wind {r0(f.now.windKmh)} km/h {compass(f.now.windDirDeg)}, gusts {r0(f.now.gustKmh)} · 24 h {r0(f.next24.minC)}–
        {r0(f.next24.maxC)}°C, {r1(f.next24.precipMm)} mm
        {data?.marine ? ` · waves ${r1(data.marine.waveHeightM)} m / ${r0(data.marine.wavePeriodS)} s` : ""}
      </span>
      <span className="meta shrink-0 normal-case tracking-normal">
        · <Attribution />
      </span>
    </div>
  );
}

/** Small line icons for WMO weather kinds. */
export function WxIcon({ icon, night, size = 16 }: { icon: WeatherIcon; night?: boolean; size?: number }) {
  const sun = (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  );
  const moon = <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />;
  const cloud = <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.2 3.5 3.5 0 0 0 7 18Z" />;
  const smallCloud = <path d="M8 19h9a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.6 1A3 3 0 0 0 8 19Z" />;
  const drops = (n: number) => (
    <path d={Array.from({ length: n }, (_, i) => `M${8 + i * 4} 20.5l-1 2`).join(" ")} />
  );
  let body: React.ReactNode;
  let color = "currentColor";
  switch (icon) {
    case "clear":
      body = night ? moon : sun;
      color = night ? "#a9b8d8" : "#f2c14e";
      break;
    case "partly":
      body = (
        <>
          <g transform="translate(-3 -4) scale(0.75)">{night ? moon : sun}</g>
          {smallCloud}
        </>
      );
      break;
    case "cloudy":
      body = cloud;
      break;
    case "fog":
      body = <path d="M4 9h16M3 13h18M5 17h14" />;
      break;
    case "drizzle":
    case "rain":
    case "showers":
      body = (
        <g transform="translate(0 -3)">
          {cloud}
          {drops(icon === "drizzle" ? 2 : 3)}
        </g>
      );
      color = "#6aa9e9";
      break;
    case "freezing":
    case "snow":
      body = (
        <g transform="translate(0 -3)">
          {cloud}
          <path d="M8 21.5h.01M12 22.5h.01M16 21.5h.01" strokeWidth={2.6} />
        </g>
      );
      color = "#cfe3f7";
      break;
    case "storm":
      body = (
        <g transform="translate(0 -3)">
          {cloud}
          <path d="m12.5 17-2 3.5h3l-2 3.5" />
        </g>
      );
      color = "#e0b54a";
      break;
    default:
      body = <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {body}
    </svg>
  );
}
