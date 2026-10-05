/**
 * Global search: locations (countries, cities, regions), events and topics,
 * plus a structured intent for natural-language-ish queries.
 */
import "server-only";
import { CITIES, COUNTRIES, findCountryByName, type Country } from "@/lib/geo/gazetteer";
import type { EventRepository } from "@/lib/db/types";
import { toEventSummary, type EventSummary, type WorldEvent } from "@/types/events";
import { textMatches, sortEvents } from "@/lib/events/query";
import { CATEGORIES } from "@/lib/categories";
import { bboxContains } from "@/lib/geo/math";
import { parseIntent, TOPIC_KEYWORDS, type ParsedIntent } from "./intent";
import type { CommandIntent } from "@/lib/ai/types";

/** Convert an AI command interpretation into the same shape the rule parser produces. */
export function intentFromAI(ai: CommandIntent): ParsedIntent {
  return {
    categories: ai.categories,
    range: ai.range,
    minMagnitude: ai.minMagnitude,
    text: ai.keywords?.toLowerCase().trim() ?? "",
    placePhrase: ai.place?.toLowerCase().trim() || null,
  };
}

export interface LocationResult {
  kind: "country" | "state" | "city" | "region";
  code: string | null;
  name: string;
  detail: string;
  lat: number;
  lon: number;
  zoom: number;
  bbox: [number, number, number, number] | null;
}

const REGION_ALIASES: Record<string, string> = {
  europe: "Europe",
  "middle east": "Middle East",
  mideast: "Middle East",
  africa: "Africa",
  asia: "Asia",
  "latin america": "Latin America",
  "south america": "Latin America",
  "central america": "Latin America",
  "north america": "North America",
  oceania: "Oceania",
  pacific: "Oceania",
};

function regionResult(region: string): LocationResult | null {
  const members = COUNTRIES.filter((c) => c.region === region);
  if (!members.length) return null;
  // Population-weighted centre of label points (avoids antimeridian bbox issues).
  let w = 0, x = 0, y = 0;
  for (const c of members) {
    const p = Math.sqrt(Math.max(c.population, 1));
    w += p;
    x += c.label[0] * p;
    y += c.label[1] * p;
  }
  return { kind: "region", code: null, name: region, detail: `${members.length} countries`, lat: y / w, lon: x / w, zoom: 2.6, bbox: null };
}

function countryResult(c: Country): LocationResult {
  return { kind: "country", code: c.code, name: c.name, detail: [c.subregion, c.region].filter(Boolean).join(" · "), lat: c.label[1], lon: c.label[0], zoom: 4, bbox: c.bbox };
}

export function searchLocations(q: string, limit = 6): LocationResult[] {
  const k = q.trim().toLowerCase();
  if (k.length < 2) return [];
  const out: LocationResult[] = [];
  const region = REGION_ALIASES[k] ?? Object.entries(REGION_ALIASES).find(([a]) => a.startsWith(k) && k.length >= 3)?.[1];
  if (region) {
    const r = regionResult(region);
    if (r) out.push(r);
  }
  const exact = findCountryByName(k);
  const seen = new Set<string>();
  if (exact) {
    out.push(countryResult(exact));
    seen.add(exact.code);
  }
  const countryMatches = COUNTRIES.filter(
    (c) => !seen.has(c.code) && (c.name.toLowerCase().startsWith(k) || c.nameLong.toLowerCase().startsWith(k) || (k.length > 3 && c.name.toLowerCase().includes(k))),
  ).sort((a, b) => b.population - a.population);
  for (const c of countryMatches.slice(0, 4)) {
    out.push(countryResult(c));
    seen.add(c.code);
  }
  // First-level admin areas (states/provinces), approximated by the bbox of their known cities.
  const admin1 = new Map<string, typeof CITIES>();
  for (const c of CITIES) {
    if (c.admin1 && c.admin1.toLowerCase() === k) {
      const key = `${c.admin1}|${c.country}`;
      admin1.set(key, [...(admin1.get(key) ?? []), c]);
    }
  }
  for (const [key, cs] of admin1) {
    const lats = cs.map((c) => c.lat), lons = cs.map((c) => c.lon);
    const bbox: [number, number, number, number] = [Math.min(...lons) - 1.5, Math.min(...lats) - 1.5, Math.max(...lons) + 1.5, Math.max(...lats) + 1.5];
    out.push({
      kind: "state",
      code: cs[0].country,
      name: key.split("|")[0],
      detail: cs[0].countryName,
      lat: (bbox[1] + bbox[3]) / 2,
      lon: (bbox[0] + bbox[2]) / 2,
      zoom: 5,
      bbox,
    });
  }
  const cityMatches = CITIES.filter((c) => c.name.toLowerCase().startsWith(k) || (k.length > 3 && c.name.toLowerCase().includes(k))).sort(
    (a, b) => b.population - a.population,
  );
  for (const c of cityMatches.slice(0, 4)) {
    out.push({
      kind: "city",
      code: c.country,
      name: c.name,
      detail: [c.admin1, c.countryName].filter(Boolean).join(", "),
      lat: c.lat,
      lon: c.lon,
      zoom: 7,
      bbox: null,
    });
  }
  return out.slice(0, limit);
}

export interface SearchOptions {
  /** Optional AI interpreter; when given it replaces the rule-based intent parser. */
  interpret?: (query: string) => Promise<CommandIntent>;
}

export async function search(repo: EventRepository, q: string, opts: SearchOptions = {}) {
  const query = q.trim().slice(0, 200);
  const ai = opts.interpret ? await opts.interpret(query) : null;
  const intent = ai ? intentFromAI(ai) : parseIntent(query);

  // Resolve place phrase from the intent ("earthquakes in japan" → Japan)
  let place: LocationResult | null = null;
  if (intent.placePhrase) {
    const words = intent.placePhrase.split(" ");
    // try the longest suffix first: "southern california" → "california"
    for (let i = 0; i < words.length && !place; i++) {
      const phrase = words.slice(i).join(" ");
      place = searchLocations(phrase, 1)[0] ?? null;
      if (place && place.name.toLowerCase() !== phrase && place.kind !== "region" && !place.name.toLowerCase().startsWith(phrase)) place = null;
    }
  }

  const locations = ai ? [] : searchLocations(query);
  if (place && !locations.some((l) => l.name === place!.name)) locations.unshift(place);

  // Events: structured filters from the intent + free text (or place) matching.
  const hasStructure = intent.categories.length > 0 || intent.minMagnitude !== null || intent.range !== null;
  const from = intent.range ? new Date(Date.now() - ({ live: 0.5, "1h": 1, "6h": 6, "24h": 24, "7d": 168 } as const)[intent.range] * 3_600_000).toISOString() : undefined;
  const pool = await repo.scan({ type: intent.categories.length ? intent.categories : undefined, from });
  const textQuery = ai ? (place ? "" : intent.text) : hasStructure ? (place ? "" : intent.text) : query;
  const matched: WorldEvent[] = pool.filter((e) => {
    if (intent.minMagnitude !== null) {
      const m = e.metrics.magnitude;
      if (typeof m !== "number" || m < intent.minMagnitude) return false;
    }
    if (place) {
      if (place.kind === "country" && e.country !== place.code) return false;
      if (place.kind === "region") {
        const region = COUNTRIES.find((c) => c.code === e.country)?.region;
        if (region !== place.name) return false;
      }
      if (place.kind === "state" && place.bbox && !bboxContains(place.bbox, e.latitude, e.longitude)) return false;
      if (place.kind === "city" && !(Math.abs(e.latitude - place.lat) < 1.5 && Math.abs(e.longitude - place.lon) < 1.5)) return false;
    }
    return textQuery ? textMatches(e, textQuery) : true;
  });
  const events: EventSummary[] = sortEvents(matched, "importance").slice(0, 12).map(toEventSummary);

  const k = query.toLowerCase();
  const topics = TOPIC_KEYWORDS.filter((t) => t.label.toLowerCase().includes(k) || t.words.some((w) => w.startsWith(k) || k.split(" ").includes(w)))
    .slice(0, 4)
    .map((t) => ({ id: t.id, label: t.label, detail: t.categories.map((c) => CATEGORIES[c].label).join(", "), categories: t.categories }));

  const describe: string[] = [];
  if (intent.categories.length) describe.push(intent.categories.map((c) => CATEGORIES[c].layerLabel).join(", "));
  if (intent.minMagnitude !== null) describe.push(`magnitude ≥ ${intent.minMagnitude}`);
  if (place) describe.push(`in ${place.name}`);
  if (intent.range) describe.push(`last ${intent.range.replace("h", " h").replace("d", " days")}`);

  return {
    query,
    intent: hasStructure || place || ai
      ? {
          source: ai ? ("ai" as const) : ("rules" as const),
          explanation: ai?.explanation ?? null,
          categories: intent.categories,
          range: intent.range,
          minMagnitude: intent.minMagnitude,
          place: place ? { name: place.name, lat: place.lat, lon: place.lon, zoom: place.zoom, country: place.kind === "country" ? place.code : null } : null,
          description: describe.join(" · ") || query,
        }
      : null,
    locations,
    events,
    topics,
    totalEventMatches: matched.length,
  };
}
