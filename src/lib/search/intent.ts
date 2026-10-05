/**
 * Rule-based query interpretation — the seam where an AI command interface
 * can plug in later. Turns phrases like "earthquakes over magnitude 5 in the
 * last six hours" into structured filters. Pure; no I/O.
 */
import { EVENT_CATEGORIES, type EventCategory } from "@/types/events";

export interface ParsedIntent {
  categories: EventCategory[];
  range: "live" | "1h" | "6h" | "24h" | "7d" | null;
  minMagnitude: number | null;
  /** Remaining free text after removing recognised phrases */
  text: string;
  /** Region/place phrase the caller should resolve ("europe", "japan") */
  placePhrase: string | null;
}

/** Topic keywords → categories (also used for the "Topics" result group). */
export const TOPIC_KEYWORDS: Array<{ id: string; label: string; words: string[]; categories: EventCategory[] }> = [
  { id: "earthquakes", label: "Earthquakes", words: ["earthquake", "earthquakes", "quake", "quakes", "seismic", "tremor"], categories: ["EARTHQUAKE"] },
  { id: "fires", label: "Fires & wildfires", words: ["fire", "fires", "wildfire", "wildfires", "blaze", "hotspot", "hotspots"], categories: ["FIRE"] },
  { id: "floods", label: "Floods", words: ["flood", "floods", "flooding"], categories: ["FLOOD"] },
  { id: "volcanoes", label: "Volcanoes", words: ["volcano", "volcanoes", "eruption", "volcanic"], categories: ["VOLCANO"] },
  { id: "storms", label: "Severe weather & storms", words: ["storm", "storms", "weather", "hurricane", "hurricanes", "cyclone", "cyclones", "typhoon", "tornado", "tornadoes", "warning", "warnings"], categories: ["WEATHER"] },
  { id: "disasters", label: "All natural hazards", words: ["disaster", "disasters", "hazard", "hazards", "drought"], categories: ["DISASTER", "EARTHQUAKE", "WEATHER", "FIRE", "FLOOD", "VOLCANO"] },
  { id: "conflict", label: "Conflict", words: ["conflict", "war", "fighting", "attack", "attacks", "military", "clash", "clashes", "strike", "strikes"], categories: ["CONFLICT"] },
  { id: "protests", label: "Protests", words: ["protest", "protests", "demonstration", "demonstrations", "rally", "riot", "riots"], categories: ["PROTEST"] },
  { id: "politics", label: "Politics & elections", words: ["politics", "political", "election", "elections", "government", "diplomacy", "diplomatic", "sanctions"], categories: ["POLITICS"] },
  { id: "space", label: "Space & launches", words: ["space", "launch", "launches", "rocket", "rockets", "satellite", "satellites"], categories: ["SPACE"] },
  { id: "business", label: "Business", words: ["business", "company", "companies", "economy", "economic"], categories: ["BUSINESS", "MARKETS"] },
  { id: "markets", label: "Markets", words: ["market", "markets", "stocks"], categories: ["MARKETS"] },
  { id: "technology", label: "Technology", words: ["technology", "tech", "cyber", "ai"], categories: ["TECHNOLOGY"] },
  { id: "science", label: "Science", words: ["science", "research"], categories: ["SCIENCE"] },
  { id: "aviation", label: "Aviation", words: ["aviation", "flight", "flights", "airport", "airports"], categories: ["AVIATION"] },
  { id: "maritime", label: "Maritime", words: ["maritime", "shipping", "port", "ports", "vessel", "ships"], categories: ["MARITIME"] },
  { id: "infrastructure", label: "Infrastructure", words: ["infrastructure", "outage", "outages", "blackout", "power"], categories: ["INFRASTRUCTURE"] },
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, "twenty-four": 24 };

const FILLER = new Set(
  "show me what's whats what is are happening happened going on in the a an of for with from around near over above last past recent latest events event major big all any news about why there so much activity today yesterday please".split(" "),
);

export function parseIntent(raw: string): ParsedIntent {
  let q = ` ${raw.toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ")} `;
  const categories = new Set<EventCategory>();
  let range: ParsedIntent["range"] = null;
  let minMagnitude: number | null = null;

  // magnitude: "over magnitude 5", "m5+", "magnitude 6 or higher", "above 5.5"
  const mag = q.match(/\b(?:over|above|greater than|>=?|at least)?\s*(?:magnitude|mag|m)\s*(\d(?:\.\d)?)\s*(?:\+|or (?:higher|more|greater)|and (?:above|up))?/);
  if (mag) {
    minMagnitude = Number(mag[1]);
    categories.add("EARTHQUAKE");
    q = q.replace(mag[0], " ");
  }

  // time: "last 6 hours", "past six hours", "last hour", "today", "this week", "yesterday"
  const t = q.match(/\b(?:last|past)\s+(\d+|[a-z-]+)?\s*(hour|hours|hr|hrs|h|day|days|week)\b/);
  if (t) {
    const n = t[1] ? (Number(t[1]) || NUMBER_WORDS[t[1]] || 1) : 1;
    const unit = t[2];
    const hours = unit.startsWith("h") ? n : unit.startsWith("d") ? n * 24 : n * 168;
    range = hours <= 1 ? "1h" : hours <= 6 ? "6h" : hours <= 24 ? "24h" : "7d";
    q = q.replace(t[0], " ");
  } else if (/\b(today|right now|now|currently)\b/.test(q)) {
    range = /\bnow|currently\b/.test(q) ? "1h" : "24h";
  } else if (/\b(yesterday|this week)\b/.test(q)) {
    range = "7d";
  }

  for (const topic of TOPIC_KEYWORDS) {
    for (const w of topic.words) {
      const re = new RegExp(`\\b${w}\\b`);
      if (re.test(q)) {
        topic.categories.forEach((c) => categories.add(c));
        q = q.replace(re, " ");
      }
    }
  }
  for (const c of EVENT_CATEGORIES) {
    const re = new RegExp(`\\b${c.toLowerCase()}\\b`);
    if (re.test(q)) {
      categories.add(c);
      q = q.replace(re, " ");
    }
  }

  const words = q.split(" ").filter((w) => w && !FILLER.has(w));
  const rest = words.join(" ").trim();
  return { categories: [...categories], range, minMagnitude, text: rest, placePhrase: rest || null };
}
