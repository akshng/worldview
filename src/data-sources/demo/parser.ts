/**
 * Synthetic event generator for DEMO MODE ONLY.
 *
 * Events are placed at real city coordinates but are entirely fabricated. Every
 * candidate is flagged `isSynthetic`, uses the SYNTHETIC source type/assertion,
 * has no source URL and is titled with a "[SIMULATED]" prefix so it can never be
 * mistaken for real data.
 */
import citiesData from "@/data/geo/cities.json";
import type { EventCandidateInput, EventCategory } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { DemoRaw } from "./types";

interface City { name: string; country: string | null; countryName: string; lat: number; lon: number; population: number }
const CITIES = (citiesData as City[]).filter((c) => c.country && c.population > 300_000);

const TEMPLATES: Array<{ type: EventCategory; subtype: string; title: (p: string) => string; weight: number }> = [
  { type: "NEWS", subtype: "general", title: (p) => `Major news development in ${p}`, weight: 6 },
  { type: "POLITICS", subtype: "government", title: (p) => `Government announcement in ${p}`, weight: 5 },
  { type: "POLITICS", subtype: "election", title: (p) => `Election activity in ${p}`, weight: 2 },
  { type: "CONFLICT", subtype: "armed-clash", title: (p) => `Armed clash reported near ${p}`, weight: 2 },
  { type: "PROTEST", subtype: "demonstration", title: (p) => `Demonstration in ${p}`, weight: 4 },
  { type: "WEATHER", subtype: "storm", title: (p) => `Severe storm warning for ${p}`, weight: 3 },
  { type: "FLOOD", subtype: "flood", title: (p) => `Flooding reported in ${p}`, weight: 2 },
  { type: "FIRE", subtype: "wildfire", title: (p) => `Wildfire near ${p}`, weight: 2 },
  { type: "EARTHQUAKE", subtype: "earthquake", title: (p) => `Earthquake felt in ${p}`, weight: 3 },
  { type: "TECHNOLOGY", subtype: "industry", title: (p) => `Technology sector news from ${p}`, weight: 3 },
  { type: "BUSINESS", subtype: "corporate", title: (p) => `Corporate announcement in ${p}`, weight: 3 },
  { type: "MARKETS", subtype: "markets", title: (p) => `Market movement in ${p}`, weight: 2 },
  { type: "AVIATION", subtype: "disruption", title: (p) => `Airport disruption at ${p}`, weight: 2 },
  { type: "MARITIME", subtype: "port", title: (p) => `Port congestion near ${p}`, weight: 1 },
  { type: "INFRASTRUCTURE", subtype: "power", title: (p) => `Power outage in ${p}`, weight: 2 },
  { type: "SCIENCE", subtype: "research", title: (p) => `Scientific announcement from ${p}`, weight: 1 },
  { type: "SPACE", subtype: "launch", title: (p) => `Launch activity near ${p}`, weight: 1 },
];
const TOTAL_WEIGHT = TEMPLATES.reduce((s, t) => s + t.weight, 0);

/** mulberry32 — small deterministic PRNG so demo data is stable between runs. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const PER_HOUR = 4;

export function generateDemoEvents(raw: DemoRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  const currentHour = Math.floor(raw.now / HOUR);
  // 7 days of history, a few events per hour, seeded per hour bucket.
  for (let h = currentHour - 24 * 7; h <= currentHour; h++) {
    const r = rng(h);
    const n = PER_HOUR + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const ts = h * HOUR + Math.floor(r() * HOUR);
      if (ts > raw.now) continue;
      let pick = r() * TOTAL_WEIGHT;
      const tpl = TEMPLATES.find((t) => (pick -= t.weight) < 0) ?? TEMPLATES[0];
      const city = CITIES[Math.floor(r() * CITIES.length)];
      const jitter = () => (r() - 0.5) * 0.6;
      const externalId = `${h}-${i}`;
      const severity = Math.round(r() * 100) / 100;
      const metrics: Record<string, number | string | boolean | null> = { demo_severity: severity };
      if (tpl.type === "EARTHQUAKE") metrics.magnitude = Math.round((3 + severity * 4) * 10) / 10;
      if (tpl.type === "WEATHER") metrics.severity = severity > 0.7 ? "Extreme" : severity > 0.4 ? "Severe" : "Moderate";
      if (tpl.type === "FIRE") metrics.frp_total_mw = Math.round(10 ** (1 + severity * 3));
      if (["NEWS", "POLITICS", "CONFLICT", "PROTEST", "TECHNOLOGY", "BUSINESS", "MARKETS"].includes(tpl.type)) {
        metrics.num_articles = 1 + Math.floor(severity * 40);
        metrics.goldstein = tpl.type === "CONFLICT" ? -Math.round(severity * 10) : 0;
      }
      candidates.push({
        type: tpl.type,
        subtype: tpl.subtype,
        title: `[SIMULATED] ${tpl.title(city.name)}`,
        summary: `Simulated event generated for demo mode. This did not happen. Location: ${city.name}, ${city.countryName}.`,
        latitude: Math.max(-89, Math.min(89, city.lat + jitter())),
        longitude: Math.max(-179.9, Math.min(179.9, city.lon + jitter())),
        geoPrecision: "city",
        locationName: `${city.name}, ${city.countryName}`,
        country: city.country,
        city: city.name,
        timestamp: new Date(ts).toISOString(),
        metrics,
        entities: [],
        isSynthetic: true,
        source: {
          id: `demo:${externalId}`,
          dataSourceId: "demo",
          externalId,
          sourceName: "WorldView demo generator (simulated)",
          sourceUrl: null,
          title: null,
          publishedAt: new Date(ts).toISOString(),
          retrievedAt: ctx.retrievedAt,
          sourceType: "SYNTHETIC",
          assertion: "SYNTHETIC",
          credibility: null,
        },
      });
    }
  }
  return { candidates, skipped: 0 };
}
