import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { TsunamiRaw } from "./types";

const tag = (b: string, n: string) => b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";

/** Message level from the feed title, e.g. "Tsunami Warning Number 2". */
export function tsunamiLevel(feedTitle: string): "warning" | "advisory" | "watch" | "information" | "threat" {
  const t = feedTitle.toLowerCase();
  if (t.includes("warning")) return "warning";
  if (t.includes("advisory")) return "advisory";
  if (t.includes("watch")) return "watch";
  if (t.includes("threat")) return "threat";
  return "information";
}

export function parseTsunami(raw: TsunamiRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const feed of raw.feeds) {
    const feedTitle = tag(feed.xml.split("<entry>")[0], "title");
    const level = tsunamiLevel(feedTitle);
    for (const entry of feed.xml.split("<entry>").slice(1)) {
      const lat = Number(tag(entry, "geo:lat")), lon = Number(tag(entry, "geo:long"));
      const updated = tag(entry, "updated");
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(Date.parse(updated))) {
        skipped++;
        continue;
      }
      // Information statements older than 3 days are history, not news.
      if (ctx.now - Date.parse(updated) > 3 * 86_400_000) {
        skipped++;
        continue;
      }
      const place = plainText(tag(entry, "title"), 200);
      const summary = plainText(tag(entry, "summary"), 1500);
      const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
      const id = tag(entry, "id") || `${feed.center}-${updated}`;
      candidates.push({
        type: "WEATHER",
        subtype: `tsunami-${level}`,
        title: `${feedTitle.replace(/\s+Number\s+\d+$/i, "")} — ${place}`,
        summary: `${feed.center} issued: ${feedTitle} for an event ${place}. ${summary.slice(0, 600)}`,
        latitude: lat,
        longitude: lon,
        geoPrecision: "exact",
        locationName: place,
        timestamp: new Date(updated).toISOString(),
        metrics: { tsunami_level: level, alert_level: level === "warning" ? "red" : level === "advisory" || level === "watch" ? "orange" : null },
        source: {
          id: `tsunami:${id}`,
          dataSourceId: "tsunami",
          externalId: id,
          sourceName: `NOAA ${feed.center}`,
          sourceUrl: safeUrl(link) ?? "https://www.tsunami.gov/",
          title: feedTitle,
          titleIsDerived: false,
          publishedAt: new Date(updated).toISOString(),
          retrievedAt: ctx.retrievedAt,
          sourceType: "OFFICIAL_AGENCY",
          assertion: "OFFICIAL_FINAL",
          credibility: { basis: "NOAA tsunami warning center (official message)" },
        },
        rawData: { feedTitle, place, updated },
      });
    }
  }
  return { candidates, skipped };
}
