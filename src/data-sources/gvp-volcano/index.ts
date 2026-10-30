/**
 * Smithsonian Global Volcanism Program / USGS Weekly Volcanic Activity Report (keyless RSS).
 * One event per volcano and weekly report, worldwide. The report summarises the observatories'
 * own statements for the week; it is labelled as a weekly summary, not a real-time alert.
 *
 * Placement: the item's `georss:point` (the volcano summit) when present, else the country in
 * the title "<Volcano> (<Country>) - Report for …" at its label point (country precision).
 */
import type { EventCandidateInput } from "@/types/events";
import { findCountryByName } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, hashId, makeSource } from "../official-common";
import { parseFeedXml } from "../news-rss/client";
import type { RssItem } from "../news-rss/types";

export interface GvpItem extends RssItem {
  lat: number | null;
  lon: number | null;
}

export interface GvpRaw {
  items: GvpItem[];
}

const FEED_URL = "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml";
const MAX_AGE_MS = 10 * 86_400_000;

/** Items with their `georss:point` ("lat lon") or `geo:lat`/`geo:long`, when the feed carries one. */
export function parseGvpXml(xml: string): GvpItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  const out: GvpItem[] = [];
  for (const b of blocks) {
    const [it] = parseFeedXml(b);
    if (!it) continue;
    const pt = b.match(/<georss:point>\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*<\/georss:point>/i);
    const gl = [b.match(/<geo:lat>\s*(-?\d+(?:\.\d+)?)\s*</i)?.[1], b.match(/<geo:long>\s*(-?\d+(?:\.\d+)?)\s*</i)?.[1]];
    const lat = pt ? Number(pt[1]) : gl[0] ? Number(gl[0]) : NaN;
    const lon = pt ? Number(pt[2]) : gl[1] ? Number(gl[1]) : NaN;
    const ok = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    out.push({ ...it, lat: ok ? lat : null, lon: ok ? lon : null });
  }
  return out;
}

export async function fetchGvp(ctx: FetchContext): Promise<GvpRaw> {
  const res = await httpGet(FEED_URL, ctx, { accept: "application/rss+xml, application/xml, text/xml" });
  return { items: parseGvpXml(await res.text()).slice(0, 120) };
}

/** "Etna (Italy) - Report for 21 October-27 October 2026 - NEW ACTIVITY/UNREST" */
export function parseGvpTitle(title: string): { volcano: string; country: string; period: string | null; status: string | null } | null {
  const m = title.match(/^(.+?)\s*\(([^)]+)\)\s*(?:[-–]\s*Report for\s+(.+?))?(?:\s+[-–]\s+([A-Za-z /]+))?\s*$/);
  if (!m) return null;
  return { volcano: m[1].trim(), country: m[2].trim(), period: m[3]?.trim() ?? null, status: m[4]?.trim() ?? null };
}

export function parseGvp(raw: GvpRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const it of raw.items ?? []) {
    const title = plainText(it.title, 300);
    const parsed = parseGvpTitle(title);
    const link = it.link?.startsWith("http") ? it.link.trim() : null;
    const t = it.published ? Date.parse(it.published) : NaN;
    if (!parsed || !link || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 86_400_000) {
      skipped++;
      continue;
    }
    // GVP lists "Country1-Country2" for border volcanoes; the first named is used for the fallback.
    const country = findCountryByName(parsed.country) ?? findCountryByName(parsed.country.split(/[-–/]/)[0].trim());
    const exact = it.lat !== null && it.lon !== null;
    if (!exact && !country) {
      skipped++;
      continue;
    }
    const vn = link.match(/[?&]vn=(\d{6})/)?.[1] ?? null;
    const externalId = `${vn ?? hashId(parsed.volcano.toLowerCase())}:${hashId(parsed.period ?? new Date(t).toISOString().slice(0, 10))}`;
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);
    const isNew = /new|unrest/i.test(parsed.status ?? "");
    const ts = new Date(t).toISOString();
    const description = plainText(it.description, 1500);
    candidates.push({
      type: "VOLCANO",
      subtype: isNew ? "weekly report — new activity/unrest" : "weekly report — ongoing activity",
      title: clip(`${parsed.volcano} (${parsed.country}): weekly volcanic activity report${parsed.period ? `, ${parsed.period}` : ""}`),
      summary: clip(
        `The Smithsonian GVP / USGS Weekly Volcanic Activity Report covers ${parsed.volcano} (${parsed.country})${parsed.period ? ` for ${parsed.period}` : ""}` +
          `${parsed.status ? ` under “${parsed.status.toLowerCase()}”` : ""}. It is a weekly summary of observatory reports, not a real-time alert.` +
          (exact ? " Shown at the volcano's summit." : ` Shown at the centre of ${country!.name} (country precision).`),
        1990,
      ),
      description: description && description !== title ? description : null,
      latitude: exact ? it.lat! : country!.label[1],
      longitude: exact ? it.lon! : country!.label[0],
      geoPrecision: exact ? "exact" : "country",
      locationName: `${parsed.volcano}, ${parsed.country}`,
      country: country?.code ?? null,
      timestamp: ts,
      metrics: { volcano: parsed.volcano, volcano_number: vn, report_period: parsed.period, new_activity: isNew },
      entities: [
        { type: "LOCATION", name: parsed.volcano, code: vn },
        ...(country ? [{ type: "COUNTRY" as const, name: country.name, code: country.code }] : []),
      ],
      source: makeSource({
        dataSourceId: "gvp-volcano",
        externalId,
        sourceName: "Smithsonian GVP — Weekly Volcanic Activity Report",
        sourceUrl: link,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        assertion: "OFFICIAL_PRELIMINARY",
        basis: "Smithsonian Institution Global Volcanism Program with the USGS Volcano Hazards Program (weekly summary of observatory reports)",
      }),
      rawData: { link, published: it.published, lat: it.lat, lon: it.lon },
    });
  }
  return { candidates, skipped };
}

export const gvpVolcanoConnector: DataSourceConnector<GvpRaw> = {
  id: "gvp-volcano",
  name: "Smithsonian weekly volcano report",
  description: "Smithsonian GVP / USGS Weekly Volcanic Activity Report: each volcano with new or ongoing activity this week, worldwide.",
  homepage: "https://volcano.si.edu/reports_weekly.cfm",
  attribution: "Global Volcanism Program, Smithsonian Institution, with the USGS Volcano Hazards Program — cite the Weekly Volcanic Activity Report and link back",
  sourceType: "SCIENTIFIC",
  categories: ["VOLCANO"],
  refreshIntervalMs: 6 * 60 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchGvp,
  parse: parseGvp,
};
