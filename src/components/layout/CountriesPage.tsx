"use client";
/** Every country, ranked by what's happening there now; pick one for its full dossier. */
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { CountryPanel } from "@/components/country-panel/CountryPanel";
import { useData } from "@/lib/client/data-store";
import { useUI } from "@/lib/store/ui";
import { useNow } from "@/lib/client/use-now";

type C = { code: string; name: string; continent: string; subregion: string; population: number };

export function CountriesPage() {
  const [list, setList] = useState<C[]>([]);
  const [q, setQ] = useState("");
  const events = useData((s) => s.events);
  const selected = useUI((s) => s.selectedCountry);
  const selectCountry = useUI((s) => s.selectCountry);
  const now = useNow(60_000);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/countries", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setList(d.countries ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // Activity in the last 24 h: event count and the most important event per country.
  const activity = useMemo(() => {
    const since = now - 86_400_000;
    const m = new Map<string, { n: number; top: number }>();
    for (const e of events) {
      if (!e.country || Date.parse(e.timestamp) < since) continue;
      const a = m.get(e.country) ?? { n: 0, top: 0 };
      a.n++;
      a.top = Math.max(a.top, e.importanceScore);
      m.set(e.country, a);
    }
    return m;
  }, [events, now]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle || c.subregion.toLowerCase().includes(needle))
      .map((c) => ({ ...c, ...(activity.get(c.code) ?? { n: 0, top: 0 }) }))
      .sort((a, b) => (needle ? a.name.localeCompare(b.name) : b.top - a.top || b.n - a.n || a.name.localeCompare(b.name)));
  }, [list, q, activity]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-line">
        <div className="shrink-0 border-b border-line p-3">
          <div className="meta mb-2 text-faint">Countries · most active first</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search countries or regions…"
            className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-line-strong"
            aria-label="Search countries"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.code}>
              <button
                onClick={() => selectCountry(c.code)}
                className={clsx("flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left text-[13px] hover:bg-panel-hover", selected === c.code && "bg-panel-hover")}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[11px] text-faint">{c.subregion}</span>
                <span className={clsx("tabular w-10 text-right text-[12px]", c.top >= 70 ? "text-warn" : c.n ? "text-muted" : "text-faint")} title={`${c.n} events in the last 24 h`}>
                  {c.n || "–"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-w-0 flex-1 justify-center overflow-y-auto p-4">
        {selected ? (
          <CountryPanel />
        ) : (
          <p className="self-center text-[13px] text-faint">Pick a country for its profile, current events, advisories and markets.</p>
        )}
      </div>
    </div>
  );
}
