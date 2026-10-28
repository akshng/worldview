/**
 * Data breaches newly added to Have I Been Pwned (keyless `GET /api/v3/breaches`).
 * Breaches added in the last 14 days; spam lists and fabricated breaches skipped.
 * HIBP gives no location: a breach of a domain under a country-code TLD (afd.de) is
 * placed in that country; others at HIBP itself (Australia), and the summary says so.
 */
import type { EventCandidateInput } from "@/types/events";
import { getCountry } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource } from "../official-common";

export interface HibpBreach {
  Name: string;
  Title: string;
  Domain?: string | null;
  BreachDate?: string | null;
  AddedDate: string;
  PwnCount?: number;
  Description?: string | null;
  DataClasses?: string[];
  IsVerified?: boolean;
  IsFabricated?: boolean;
  IsSpamList?: boolean;
  IsRetired?: boolean;
  IsMalware?: boolean;
  IsStealerLog?: boolean;
}
export interface HibpRaw {
  breaches: HibpBreach[];
}

const MAX_AGE_MS = 14 * 86_400_000;

export async function fetchHibp(ctx: FetchContext): Promise<HibpRaw> {
  const all = (await (await httpGet("https://haveibeenpwned.com/api/v3/breaches", ctx)).json()) as HibpBreach[];
  // ~1 MB for the full catalogue; keep only recent additions.
  return { breaches: (Array.isArray(all) ? all : []).filter((b) => ctx.now - Date.parse(b.AddedDate) <= MAX_AGE_MS + 86_400_000) };
}

/** Country-code TLDs that are mostly used generically (.io, .co, .ai, …): not a location. */
const GENERIC_CCTLD = new Set(["io", "co", "ai", "me", "tv", "gg", "cc", "ws", "fm", "ly", "to", "so", "sh", "ac", "la", "gl", "im", "ag", "vc", "nu", "tk", "ml", "ga", "cf", "gq", "app", "dev"]);

export function countryOfDomain(domain: string | null | undefined) {
  const tld = domain?.trim().toLowerCase().split(".").pop();
  if (!tld || tld.length !== 2 || GENERIC_CCTLD.has(tld)) return null;
  return getCountry(tld === "uk" ? "GB" : tld.toUpperCase()) ?? null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function parseHibp(raw: HibpRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const b of raw.breaches ?? []) {
    const added = Date.parse(b.AddedDate);
    if (!b.Name || !b.Title || Number.isNaN(added) || ctx.now - added > MAX_AGE_MS || b.IsSpamList || b.IsFabricated || b.IsRetired) {
      skipped++;
      continue;
    }
    const country = countryOfDomain(b.Domain);
    const ts = new Date(added).toISOString();
    const name = plainText(b.Title, 120);
    const classes = (b.DataClasses ?? []).slice(0, 8);
    const title = clip(`Data breach added to Have I Been Pwned: ${name}${b.PwnCount ? ` (${fmt(b.PwnCount)} accounts)` : ""}`);
    candidates.push({
      type: "TECHNOLOGY",
      subtype: "data breach",
      title,
      summary:
        `Have I Been Pwned added the ${name}${b.Domain ? ` (${b.Domain})` : ""} breach on ${ts.slice(0, 10)}` +
        `${b.PwnCount ? `: ${fmt(b.PwnCount)} accounts` : ""}${b.BreachDate ? `, breach dated ${b.BreachDate}` : ""}.` +
        `${classes.length ? ` Exposed data: ${classes.join(", ")}.` : ""}${b.IsVerified ? " HIBP lists it as verified." : " HIBP lists it as unverified."}` +
        (country ? ` Placed in ${country.name} from the domain's country code.` : " HIBP gives no location; shown at HIBP (Australia), not at the breached organisation."),
      description: plainText(b.Description, 1500) || null,
      latitude: country ? country.label[1] : HQ.hibp.lat,
      longitude: country ? country.label[0] : HQ.hibp.lon,
      geoPrecision: country ? "country" : "approximate",
      locationName: country ? country.name : HQ.hibp.name,
      country: country ? country.code : null,
      timestamp: ts,
      metrics: { accounts: b.PwnCount ?? null, breach_date: b.BreachDate ?? null, verified: !!b.IsVerified, stealer_log: !!b.IsStealerLog },
      entities: [{ type: "ORGANIZATION", name, code: null }],
      source: makeSource({
        dataSourceId: "hibp-breaches",
        externalId: b.Name,
        sourceName: "Have I Been Pwned",
        sourceUrl: `https://haveibeenpwned.com/Breach/${encodeURIComponent(b.Name)}`,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        sourceType: "COMMUNITY_DATABASE",
        assertion: b.IsVerified ? "OFFICIAL_PRELIMINARY" : "MEDIA_REPORT",
        basis: "Have I Been Pwned breach catalogue (Troy Hunt), CC BY 4.0",
      }),
      rawData: { Name: b.Name, Domain: b.Domain, AddedDate: b.AddedDate, BreachDate: b.BreachDate, PwnCount: b.PwnCount },
    });
  }
  return { candidates, skipped };
}

export const hibpBreachesConnector: DataSourceConnector<HibpRaw> = {
  id: "hibp-breaches",
  name: "Data breaches (HIBP)",
  description: "Breaches newly added to Have I Been Pwned (last 14 days) with account counts and exposed data types.",
  homepage: "https://haveibeenpwned.com/PwnedWebsites",
  attribution: "Have I Been Pwned — breach data licensed CC BY 4.0; attribution with a link to haveibeenpwned.com required",
  sourceType: "COMMUNITY_DATABASE",
  categories: ["TECHNOLOGY"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchHibp,
  parse: parseHibp,
};
