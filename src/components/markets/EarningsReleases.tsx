"use client";
/** Earnings releases furnished to the SEC (8-K Item 2.02), last 7 days. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { EarningsFeed } from "@/lib/finance/earnings";
import { useUI } from "@/lib/store/ui";

export function EarningsReleases() {
  const [data, setData] = useState<EarningsFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const openInstrument = useUI((s) => s.openInstrument);
  useEffect(() => {
    api.earnings().then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-[12px] text-warn">Earnings releases unavailable: {err}</p>;
  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  const needle = q.trim().toLowerCase();
  const rows = data.releases.filter((r) => !needle || r.company.toLowerCase().includes(needle) || r.ticker?.toLowerCase() === needle);
  const shown = all || needle ? rows.slice(0, 60) : rows.slice(0, 12);
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${data.releases.length} companies or ticker`}
        aria-label="Filter earnings releases"
        className="mb-1 w-full rounded border border-line bg-bg-elev px-2 py-1 text-[12px]"
      />
      <ul>
        {shown.map((r) => (
          <li key={r.url} className="flex items-baseline gap-2 border-t border-line py-1 text-[12px]">
            <span className="tabular shrink-0 text-faint">{r.filed.slice(5)}</span>
            <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent" title={`${r.company} — 8-K Item 2.02${r.otherItems.length ? ` (+ items ${r.otherItems.join(", ")})` : ""}${r.location ? ` · ${r.location}` : ""}. Opens the filing on sec.gov`}>
              {r.company}
            </a>
            {r.ticker ? (
              <button onClick={() => openInstrument(r.ticker!)} className="shrink-0 text-[11px] text-muted hover:text-accent" title={`Open ${r.ticker}`}>
                {r.ticker}
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-faint">—</span>
            )}
          </li>
        ))}
        {!shown.length && <li className="text-[12px] text-faint">{needle ? "No match." : "None in the last 7 days."}</li>}
      </ul>
      {!needle && rows.length > 12 && (
        <button onClick={() => setAll((v) => !v)} className="meta mt-1 text-faint hover:text-fg">{all ? "Show fewer" : `Show ${Math.min(60, rows.length)} of ${rows.length}`}</button>
      )}
      <p className="mt-1 text-[10.5px] text-faint">
        SEC EDGAR full-text search, {data.from} to {data.to}. Companies furnish their results press release under 8-K Item 2.02; the link opens the filing. Information only — not investment advice.
      </p>
    </div>
  );
}
