"use client";
/**
 * "Plot anything": one searchable list of everything the globe can show —
 * every data source, live tracking, infrastructure and the map itself.
 * Ticking a source plots only the sources you picked; the rest are toggles.
 */
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { useData } from "@/lib/client/data-store";
import { INFRA_LAYERS } from "@/lib/infra/catalog";
import { useUI, type Settings } from "@/lib/store/ui";

type Source = { id: string; name: string; categories: string[]; status: string };

const TRACKING: Array<{ key: keyof Settings; label: string; hint: string }> = [
  { key: "showShips", label: "Ships", hint: "Live AIS vessel positions" },
  { key: "showAircraft", label: "Civilian aircraft", hint: "Live ADS-B flights in view" },
  { key: "showMilAir", label: "Military aircraft", hint: "Military ADS-B transponders worldwide" },
  { key: "showSatellites", label: "Satellites", hint: "Tracked satellites (CelesTrak)" },
  { key: "showIss", label: "ISS", hint: "International Space Station" },
  { key: "showAurora", label: "Aurora forecast", hint: "NOAA aurora probability" },
  { key: "showCameras", label: "Public cameras", hint: "Traffic and public webcams" },
];
const MAP_TOGGLES: Array<{ key: keyof Settings; label: string }> = [
  { key: "showClouds", label: "Clouds (satellite)" },
  { key: "showDayNight", label: "Day / night line" },
  { key: "showEventLabels", label: "Event labels" },
];

function Row({ on, label, hint, count, onClick, dim }: { on: boolean; label: string; hint?: string; count?: number; onClick: () => void; dim?: boolean }) {
  return (
    <button onClick={onClick} title={hint} className={clsx("flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left text-[12.5px] hover:bg-panel-hover", dim && "opacity-55")}>
      <span className={clsx("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px]", on ? "border-accent bg-accent text-bg" : "border-line-strong")}>{on ? "✓" : ""}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular text-[11px] text-faint">{count || ""}</span>}
    </button>
  );
}

function Group({ title, children, right, open: defOpen = false, force }: { title: string; children: React.ReactNode; right?: React.ReactNode; open?: boolean; force?: boolean }) {
  const [open, setOpen] = useState(defOpen);
  const shown = force || open;
  return (
    <section className="border-t border-line px-3 py-2">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen((v) => !v)} className="meta flex items-center gap-1 text-faint hover:text-fg">
          <span className={clsx("inline-block transition-transform", shown && "rotate-90")}>›</span> {title}
        </button>
        {right}
      </div>
      {shown && <div className="mt-1">{children}</div>}
    </section>
  );
}

export function PlotPanel() {
  const [q, setQ] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSettings);
  const sourceFilter = useUI((s) => s.sourceFilter);
  const toggleSource = useUI((s) => s.toggleSource);
  const setSourceFilter = useUI((s) => s.setSourceFilter);
  const toggleInfra = useUI((s) => s.toggleInfraLayer);
  const events = useData((s) => s.events);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .sources(ctrl.signal)
      .then((d) => setSources(d.sources.filter((s) => s.id !== "demo").map((s) => ({ id: s.id, name: s.name, categories: s.categories, status: s.status }))))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const perSource = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) for (const id of e.sourceIds ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [events]);

  const needle = q.trim().toLowerCase();
  const match = (...parts: string[]) => !needle || parts.some((p) => p.toLowerCase().includes(needle));
  const srcRows = sources.filter((s) => match(s.name, s.id, ...s.categories)).sort((a, b) => (perSource.get(b.id) ?? 0) - (perSource.get(a.id) ?? 0));
  const trackRows = TRACKING.filter((t) => match(t.label, t.hint));
  const infraRows = INFRA_LAYERS.filter((l) => match(l.label, l.note));
  const mapRows = MAP_TOGGLES.filter((m) => match(m.label));
  const searching = needle.length > 0;
  const on = new Set(sourceFilter);

  return (
    <div>
      <div className="px-3 pb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find anything to plot… (ships, sanctions, cables)"
          aria-label="Find anything to plot"
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px] outline-none focus:border-line-strong"
        />
      </div>
      {trackRows.length > 0 && (
        <Group title="Live tracking" open force={searching}>
          {trackRows.map((t) => (
            <Row key={t.key} on={Boolean(settings[t.key])} label={t.label} hint={t.hint} onClick={() => update({ [t.key]: !settings[t.key] } as Partial<Settings>)} />
          ))}
        </Group>
      )}
      {srcRows.length > 0 && (
        <Group
          title={`Data sources (${sources.length})`}
          force={searching}
          right={sourceFilter.length > 0 ? <button className="meta text-faint hover:text-fg" onClick={() => setSourceFilter([])}>All</button> : undefined}
        >
          <p className="mb-1 px-1.5 text-[11px] text-faint">{sourceFilter.length ? `Plotting only ${sourceFilter.length} picked` : "Tick sources to plot only those"}</p>
          <div className="max-h-[300px] overflow-y-auto">
            {srcRows.map((s) => (
              <Row key={s.id} on={on.has(s.id)} label={s.name} hint={`${s.id} · ${s.categories.join(", ")} · ${s.status.toLowerCase()}`} count={perSource.get(s.id) ?? 0} dim={!perSource.get(s.id)} onClick={() => toggleSource(s.id)} />
            ))}
          </div>
        </Group>
      )}
      {infraRows.length > 0 && (
        <Group title="Infrastructure" force={searching}>
          {infraRows.map((l) => (
            <Row key={l.id} on={settings.infraLayers.includes(l.id)} label={l.label} hint={l.note} onClick={() => toggleInfra(l.id)} />
          ))}
        </Group>
      )}
      {(mapRows.length > 0 || match("satellite", "dark", "night", "map")) && (
        <Group title="Map" force={searching}>
          <div className="mb-1 flex gap-1 px-1.5">
            {(["dark", "satellite", "night"] as const).map((m) => (
              <button key={m} onClick={() => update({ mapStyle: m })} className={clsx("flex-1 rounded border px-1 py-[3px] text-[11.5px] capitalize", settings.mapStyle === m ? "border-accent text-fg" : "border-line text-muted hover:text-fg")}>
                {m}
              </button>
            ))}
          </div>
          {mapRows.map((m) => (
            <Row key={m.key} on={Boolean(settings[m.key])} label={m.label} onClick={() => update({ [m.key]: !settings[m.key] } as Partial<Settings>)} />
          ))}
        </Group>
      )}
    </div>
  );
}
