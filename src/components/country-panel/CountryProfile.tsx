"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { SectionTitle } from "@/components/ui/primitives";
import type { CountryProfile as Profile, ProfileStat } from "@/lib/country-profile";

function compact(v: number, prefix = ""): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${sign}${prefix}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${Math.round(a).toLocaleString("en-US")}`;
}

export function formatProfileValue(s: Pick<ProfileStat, "value" | "unit">): string {
  switch (s.unit) {
    case "people":
      return compact(s.value);
    case "USD":
      return compact(s.value, "$");
    case "index":
      return s.value.toFixed(3);
    default:
      return `${s.value < 0 ? "−" : ""}${Math.abs(s.value).toFixed(1)}%`;
  }
}

function hoverText(s: ProfileStat): string {
  const unit = s.unit === "% of GDP" ? " (% of GDP)" : s.unit === "% p.a." ? " (% per year)" : "";
  return `${s.label}${unit}, ${s.period}\nSource: ${s.source}, ${s.series}${s.community ? "\nCommunity-edited data (Wikidata), not an official statistic" : ""}`;
}

/** Key stats and facts for the selected country (World Bank, IMF, Eurostat, OECD, Wikidata). */
export function CountryProfile({ code }: { code: string }) {
  const [res, setRes] = useState<{ code: string; profile: Profile | null; error?: string } | null>(null);
  useEffect(() => {
    if (!/^[A-Z]{2,3}$/.test(code)) return;
    const ctrl = new AbortController();
    api
      .countryProfile(code, ctrl.signal)
      .then((profile) => setRes({ code, profile }))
      .catch((e) => e.name !== "AbortError" && setRes({ code, profile: null, error: e.message }));
    return () => ctrl.abort();
  }, [code]);

  const cur = res?.code === code ? res : null;
  const p = cur?.profile;
  const facts = p?.facts;
  const factRows = facts
    ? ([
        ["Capital", facts.capital.join(", ")],
        ["Currency", facts.currencies.map((c) => (c.code && c.code !== c.name ? `${c.name} (${c.code})` : c.name)).join(", ")],
        ["Head of state", facts.headOfState.join(", ")],
        ["Head of gov.", facts.headOfGovernment.join(", ")],
      ].filter(([, v]) => v) as Array<[string, string]>)
    : [];
  const failed = p?.sources.filter((s) => !s.ok).map((s) => s.source) ?? [];

  return (
    <section className="border-b border-line px-4 py-3.5">
      <SectionTitle right={failed.length ? <span className="meta text-faint" title={p!.sources.filter((s) => !s.ok).map((s) => `${s.source}: ${s.error}`).join("\n")}>{failed.join(", ")} unavailable</span> : null}>
        Profile
      </SectionTitle>
      {!cur && <p className="text-[12px] text-muted">Loading…</p>}
      {cur?.error && <p className="text-[12px] text-warn">Country profile unavailable right now.</p>}
      {p && p.stats.length === 0 && factRows.length === 0 && <p className="text-[12px] text-muted">No profile data for this country.</p>}
      {p && p.stats.length > 0 && (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
          {p.stats.map((s) => (
            <div key={s.key} title={hoverText(s)} className="min-w-0 cursor-help">
              <dt className="meta truncate text-faint">{s.label}</dt>
              <dd className={clsx("tabular text-[14px] font-medium leading-tight", s.community && "text-muted")}>
                {formatProfileValue(s)}
                {s.community && <span className="text-faint">*</span>}
              </dd>
              <dd className="text-[10px] text-faint">
                {s.period} · {s.source}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {factRows.length > 0 && (
        <dl className="mt-3 space-y-0.5 text-[12px]">
          {factRows.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-24 shrink-0 text-faint">{k}</dt>
              <dd className="min-w-0 flex-1 truncate" title={`${v}\nSource: Wikidata (community-edited)`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {p && (p.stats.length > 0 || factRows.length > 0) && (
        <p className="mt-2 text-[10.5px] text-faint">
          Official statistics from the World Bank, IMF, Eurostat, OECD and FRED; hover a value for its series. Capital, currency, leaders and starred values are community data from Wikidata.
        </p>
      )}
    </section>
  );
}
