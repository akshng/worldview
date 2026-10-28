/**
 * U.S. Treasury OFAC sanctions list changes, from the official Sanctions List Service (keyless).
 * `changes/history/{year}` lists publications; `changes/{id}` returns that publication's delta
 * file (entries added to / removed from the SDN and consolidated lists). One event per
 * publication, placed at the Treasury in Washington.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource } from "../official-common";

const BASE = "https://sanctionslistservice.ofac.treas.gov";
const MAX_AGE_MS = 14 * 86_400_000;
const MAX_PUBLICATIONS = 6;

export interface OfacPublication {
  publicationID: number;
  datePublished: string;
}
export interface OfacRaw {
  publications: Array<OfacPublication & { xml: string | null }>;
}

export async function fetchOfac(ctx: FetchContext): Promise<OfacRaw> {
  const year = new Date(ctx.now).getUTCFullYear();
  const years = new Date(ctx.now).getUTCMonth() === 0 ? [year, year - 1] : [year];
  const pubs: OfacPublication[] = [];
  for (const y of years) {
    const list = (await (await httpGet(`${BASE}/changes/history/${y}`, ctx)).json()) as OfacPublication[];
    pubs.push(...(Array.isArray(list) ? list : []));
  }
  const recent = pubs
    .filter((p) => typeof p.publicationID === "number" && ctx.now - Date.parse(`${p.datePublished}Z`) <= MAX_AGE_MS)
    .sort((a, b) => b.publicationID - a.publicationID)
    .slice(0, MAX_PUBLICATIONS);
  const publications: OfacRaw["publications"] = [];
  for (const p of recent) {
    // Redirects to a short-lived signed S3 URL with the delta XML.
    const xml = await httpGet(`${BASE}/changes/${p.publicationID}`, ctx, { accept: "text/xml, application/xml" })
      .then((r) => r.text())
      .catch(() => null);
    publications.push({ ...p, xml });
  }
  return { publications };
}

export interface OfacEntry {
  action: string;
  type: string;
  name: string;
  programs: string[];
  countries: string[];
}

/** Read the entities of a delta file (regex reader; the format is flat and machine-generated). */
export function parseDelta(xml: string): { publicationType: string | null; utcOffset: string | null; entries: OfacEntry[] } {
  const publicationType = xml.match(/<publicationType>([^<]*)<\/publicationType>/)?.[1]?.trim() ?? null;
  // The delta's own date carries the zone (US Eastern) that the history list's times omit.
  const utcOffset = xml.match(/<datePublished>[^<]*([+-]\d\d:\d\d)<\/datePublished>/)?.[1] ?? null;
  const entries: OfacEntry[] = [];
  for (const m of xml.matchAll(/<entity\b[^>]*\baction="([a-z]+)"[^>]*>([\s\S]*?)<\/entity>/g)) {
    const body = m[2];
    const type = body.match(/<entityType\b[^>]*>([^<]*)</)?.[1]?.trim() ?? "Entry";
    // The primary name is the first formattedFullName inside the <name> marked primary.
    const primary = body.match(/<name\b[^>]*>\s*<isPrimary>true<\/isPrimary>[\s\S]*?<formattedFullName>([^<]*)</);
    const name = (primary?.[1] ?? body.match(/<formattedFullName>([^<]*)</)?.[1] ?? "").trim();
    const programs = [...new Set([...body.matchAll(/<sanctionsProgram\b[^>]*>([^<]+)</g)].map((x) => x[1].trim()))];
    const countries = [...new Set([...body.matchAll(/<country\b[^>]*>([^<]+)</g)].map((x) => x[1].trim()))];
    entries.push({ action: m[1], type, name, programs, countries });
  }
  return { publicationType, utcOffset, entries };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function topCounts(xs: string[], n: number): string[] {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

export function parseOfac(raw: OfacRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (const p of raw.publications ?? []) {
    if (!p.xml) {
      skipped++;
      warnings.push(`publication ${p.publicationID}: delta file unavailable`);
      continue;
    }
    const { publicationType, utcOffset, entries } = parseDelta(p.xml);
    if (!entries.length) {
      skipped++;
      continue;
    }
    const adds = entries.filter((e) => e.action === "add");
    const removes = entries.filter((e) => e.action === "remove");
    const updates = entries.length - adds.length - removes.length;
    const programs = topCounts(entries.flatMap((e) => e.programs), 4);
    const countries = topCounts(entries.flatMap((e) => e.countries), 5);
    const counts = [adds.length && plural(adds.length, "addition"), removes.length && plural(removes.length, "removal"), updates && plural(updates, "update")].filter(Boolean).join(", ");
    const t = Date.parse(`${p.datePublished.replace(/(\.\d{3})\d+$/, "$1")}${utcOffset ?? "-05:00"}`);
    if (Number.isNaN(t)) {
      skipped++;
      continue;
    }
    const published = new Date(t).toISOString();
    const named = adds.slice(0, 5).map((e) => `${e.name} (${e.type.toLowerCase()})`).filter((s) => s.length > 12);
    const title = clip(`OFAC sanctions list update: ${counts}${programs.length ? ` — ${programs.join(", ")}` : ""}`);
    candidates.push({
      type: "POLITICS",
      subtype: "sanctions",
      title,
      summary:
        `The U.S. Treasury's Office of Foreign Assets Control published sanctions list changes on ${published.slice(0, 10)}` +
        `${publicationType ? ` (${publicationType})` : ""}: ${counts}.` +
        `${programs.length ? ` Programs: ${programs.join(", ")}.` : ""}${countries.length ? ` Address countries in the entries: ${countries.join(", ")}.` : ""}` +
        `${named.length ? ` Added include ${named.join("; ")}.` : ""}`.slice(0, 1990),
      latitude: HQ.treasury.lat,
      longitude: HQ.treasury.lon,
      geoPrecision: "city",
      locationName: HQ.treasury.name,
      country: "US",
      timestamp: published,
      metrics: { additions: adds.length, removals: removes.length, updates, publication_id: p.publicationID },
      entities: [
        { type: "ORGANIZATION", name: "Office of Foreign Assets Control", code: "OFAC" },
        ...adds.slice(0, 15).filter((e) => e.name).map((e) => ({ type: e.type === "Individual" ? ("PERSON" as const) : e.type === "Vessel" ? ("VEHICLE" as const) : ("ORGANIZATION" as const), name: e.name, code: null })),
      ],
      source: makeSource({
        dataSourceId: "ofac-sanctions",
        externalId: String(p.publicationID),
        sourceName: "OFAC Sanctions List Service (U.S. Treasury)",
        sourceUrl: "https://ofac.treasury.gov/recent-actions",
        title,
        publishedAt: published,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. Department of the Treasury, Office of Foreign Assets Control",
      }),
      rawData: { publicationID: p.publicationID, datePublished: p.datePublished, publicationType, entries: entries.slice(0, 40) },
    });
  }
  return { candidates, skipped, warnings: warnings.length ? warnings : undefined };
}

export const ofacSanctionsConnector: DataSourceConnector<OfacRaw> = {
  id: "ofac-sanctions",
  name: "US sanctions (OFAC)",
  description: "OFAC sanctions list publications from the last 14 days: entries added to and removed from the SDN and consolidated lists, with programs.",
  homepage: "https://sanctionslistservice.ofac.treas.gov/",
  attribution: "U.S. Department of the Treasury, Office of Foreign Assets Control — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 60 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchOfac,
  parse: parseOfac,
};
