/**
 * Ransomware leak-site claims, from the ransomware.live public API (keyless, community-run).
 * Each record is a criminal group's *claim* to have attacked an organisation, collected
 * from leak sites — unverified by design. Placed at the victim's country; records without
 * a country are skipped. The groups' own posts are never copied (they carry extortion text).
 */
import type { EventCandidateInput } from "@/types/events";
import { getCountry } from "@/lib/geo/gazetteer";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface RansomwareVictim {
  victim: string;
  group: string;
  country?: string | null;
  activity?: string | null;
  domain?: string | null;
  discovered?: string | null;
  attackdate?: string | null;
  url?: string | null;
}
export interface RansomwareRaw {
  victims: RansomwareVictim[];
}

const MAX_AGE_MS = 3 * 86_400_000;

export async function fetchRansomware(ctx: FetchContext): Promise<RansomwareRaw> {
  const j = (await (await httpGet("https://api.ransomware.live/v2/recentvictims", ctx)).json()) as RansomwareVictim[];
  // Keep only the fields used; drop the group's post text, screenshots and onion links.
  return {
    victims: (Array.isArray(j) ? j : []).map((v) => ({ victim: v.victim, group: v.group, country: v.country, activity: v.activity, domain: v.domain, discovered: v.discovered, attackdate: v.attackdate, url: v.url })),
  };
}

export function parseRansomware(raw: RansomwareRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const v of raw.victims ?? []) {
    const victim = plainText(v.victim, 150);
    const group = plainText(v.group, 60);
    const country = getCountry(v.country?.trim().toUpperCase() || null);
    const claimed = Date.parse(v.discovered ?? v.attackdate ?? "");
    const key = `${victim.toLowerCase()}@${group.toLowerCase()}`;
    if (!victim || !group || !country || Number.isNaN(claimed) || ctx.now - claimed > MAX_AGE_MS || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const ts = new Date(claimed).toISOString();
    const sector = v.activity && !/^not found$/i.test(v.activity) ? plainText(v.activity, 60) : null;
    const title = clip(`Ransomware claim: ${group} lists ${victim}${victim.toLowerCase().includes(country.name.toLowerCase()) ? "" : ` (${country.name})`}`);
    candidates.push({
      type: "TECHNOLOGY",
      subtype: "cyber attack",
      title,
      summary:
        `The ransomware group ${group} listed ${victim}${sector ? ` (${sector})` : ""} in ${country.name} on its leak site; ransomware.live recorded the claim at ${ts.slice(0, 16).replace("T", " ")} UTC. ` +
        "This is the group's unverified claim, not a confirmed attack. Placed at the country, not the organisation's site.",
      latitude: country.label[1],
      longitude: country.label[0],
      geoPrecision: "country",
      locationName: country.name,
      country: country.code,
      timestamp: ts,
      metrics: { group, sector, domain: v.domain ?? null, claim: true },
      entities: [{ type: "ORGANIZATION", name: victim, code: null }, { type: "ACTOR", name: group, code: null }, { type: "COUNTRY", name: country.name, code: country.code }],
      source: makeSource({
        dataSourceId: "ransomware-live",
        externalId: key,
        sourceName: "ransomware.live",
        sourceUrl: safeUrl(v.url) ?? "https://www.ransomware.live/",
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        sourceType: "COMMUNITY_DATABASE",
        assertion: "MEDIA_REPORT",
        basis: "Community-run tracker of ransomware leak-site posts (claims by criminal groups, unverified)",
      }),
      rawData: { victim: v.victim, group: v.group, country: v.country, discovered: v.discovered, attackdate: v.attackdate },
    });
  }
  return { candidates, skipped };
}

export const ransomwareLiveConnector: DataSourceConnector<RansomwareRaw> = {
  id: "ransomware-live",
  name: "Ransomware claims",
  description: "Organisations newly listed on ransomware groups' leak sites (last 3 days), from ransomware.live — unverified claims, placed at the victim's country.",
  homepage: "https://www.ransomware.live/",
  attribution: "ransomware.live (Julien Mousqueton) — free public API for non-commercial use; attribution requested",
  sourceType: "COMMUNITY_DATABASE",
  categories: ["TECHNOLOGY"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchRansomware,
  parse: parseRansomware,
};
