/**
 * Finds places named in a headline, used to sanity-check machine geocoding
 * (GDELT) and to give offshore events the country their source names.
 */
import "server-only";
import { CITIES, COUNTRIES, findCountryByName, type City, type Country } from "./gazetteer";

export interface HeadlinePlace {
  name: string;
  country: Country;
  city: City | null;
  /** Introduced by a locative cue ("in", "near", "southern" …) */
  cued: boolean;
  index: number;
}

const CUE = /\b(in|near|at|across|outside|inside|into|from|off|over)\s+((?:the\s+)?(?:north|south|east|west|northern|southern|eastern|western|central|northeastern|northwestern|southeastern|southwestern|occupied)?\s*)$/;

// Common words that are also place names; ignored unless capitalised context is unavailable.
const AMBIGUOUS = new Set(["mobile", "nice", "reading", "bath", "split", "victoria", "georgia", "jordan", "chad", "march", "may", "orange", "nancy", "sale", "split"]);

const COUNTRY_NAMES: Array<{ re: RegExp; country: Country; name: string }> = [];
const EXTRA_ALIASES: Record<string, string> = {
  "u.s.": "US", "u.s": "US", usa: "US", "united states": "US", america: "US", uk: "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB",
  russia: "RU", "south korea": "KR", "north korea": "KP", iran: "IR", syria: "SY", gaza: "PS", "west bank": "PS", palestine: "PS",
  turkiye: "TR", "türkiye": "TR",
  uae: "AE", "dr congo": "CD", "drc": "CD", "ivory coast": "CI", "czech republic": "CZ", burma: "MM", vietnam: "VN", laos: "LA", taiwan: "TW",
};
function add(name: string, country: Country | undefined) {
  if (!country || name.length < 4 && !["usa", "uk", "uae", "drc", "u.s"].includes(name)) return;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // URL-derived headlines lose apostrophes: "UK's" → "uks", "Yemen's" → "yemens".
  COUNTRY_NAMES.push({ re: new RegExp(`(^|[^a-z])${esc}(?:'?s)?([^a-z]|$)`, "i"), country, name });
}
for (const c of COUNTRIES) if (c.code.length === 2) for (const n of new Set([c.name, c.nameLong])) if (!AMBIGUOUS.has(n.toLowerCase())) add(n, c);
for (const [alias, code] of Object.entries(EXTRA_ALIASES)) add(alias, COUNTRIES.find((c) => c.code === code));

const BIG_CITIES = CITIES.filter((c) => c.country && c.population >= 400_000 && c.name.length >= 4 && !AMBIGUOUS.has(c.name.toLowerCase()));
const CITY_RES = BIG_CITIES.map((city) => ({ city, re: new RegExp(`(^|[^a-z])${city.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i") }));

const US_STATE_LIST = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming",
];

/** Approximate state centre from the bundled US cities in that state. */
function stateCenter(state: string): [number, number] | null {
  const cs = CITIES.filter((c) => c.country === "US" && c.admin1?.toLowerCase() === state);
  if (!cs.length) return null;
  return [cs.reduce((s, c) => s + c.lon, 0) / cs.length, cs.reduce((s, c) => s + c.lat, 0) / cs.length];
}

export function placesInText(text: string): HeadlinePlace[] {
  const lower = ` ${text.toLowerCase()} `;
  const out: HeadlinePlace[] = [];
  const seen = new Set<string>();
  const cued = (idx: number) => CUE.test(lower.slice(Math.max(0, idx - 40), idx));
  const us = COUNTRIES.find((c) => c.code === "US")!;
  for (const { city, re } of CITY_RES) {
    const m = re.exec(lower);
    if (!m) continue;
    // "Vienna Georgia", "Paris Texas": a US town sharing a famous city's name.
    const after = lower.slice(m.index + m[0].length - (m[2] ? 1 : 0)).trimStart();
    const state = city.country !== "US" ? US_STATE_LIST.find((st) => after.startsWith(st + " ") || after === st) : undefined;
    if (state) {
      const idx = m.index + m[1].length;
      const center = stateCenter(state);
      out.push({
        name: `${city.name}, ${state.replace(/\b\w/g, (x) => x.toUpperCase())}`,
        country: us,
        city: center ? { name: `${city.name}, ${state.replace(/\b\w/g, (x) => x.toUpperCase())}`, country: "US", countryName: us.name, admin1: state, lat: center[1], lon: center[0], population: 0, capital: false } : null,
        cued: true,
        index: idx,
      });
      seen.add("country:US");
      continue;
    }
    const country = COUNTRIES.find((c) => c.code === city.country);
    if (!country) continue;
    const idx = m.index + m[1].length;
    out.push({ name: city.name, country, city, cued: cued(idx), index: idx });
    seen.add(`city:${city.name}`);
  }
  for (const { re, country } of COUNTRY_NAMES) {
    const m = re.exec(lower);
    if (!m || seen.has(`country:${country.code}`)) continue;
    const idx = m.index + m[1].length;
    seen.add(`country:${country.code}`);
    out.push({ name: country.name, country, city: null, cued: cued(idx), index: idx });
  }
  return out.sort((a, b) => a.index - b.index);
}

const US_STATES = new Set(
  "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada new hampshire new jersey new mexico new york north carolina north dakota ohio oklahoma oregon pennsylvania rhode island south carolina south dakota tennessee texas utah vermont virginia washington west virginia wisconsin wyoming puerto rico"
    .split(" "),
);
const US_ABBR = new Set("AK AL AR AZ CA CO CT DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY PR".split(" "));

/**
 * Country named at the end of a source's place text, e.g. USGS
 * "100 km E of Miyako, Japan", "off the coast of Oregon", "5 km N of X, CA".
 */
export function countryFromPlaceText(text: string | null): Country | null {
  if (!text) return null;
  const last = text.split(",").pop()!.trim();
  if (US_ABBR.has(last)) return COUNTRIES.find((c) => c.code === "US") ?? null;
  const words = last.toLowerCase().replace(/[^a-z\s.-]/g, " ").split(/\s+/).filter(Boolean);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const phrase = words.slice(-n).join(" ");
    if (US_STATES.has(phrase) || (n === 2 && US_STATES.has(words.slice(-2).join(" ")))) return COUNTRIES.find((c) => c.code === "US") ?? null;
    const c = findCountryByName(phrase);
    if (c) return c;
  }
  return null;
}

// "Georgia" (country) and "Washington" (the capital, as in US politics) are too ambiguous to place on a state.
const PLACEABLE_STATES = US_STATE_LIST.filter((st) => st !== "georgia" && st !== "washington");
const STATE_RES = PLACEABLE_STATES.map((st) => ({ st, re: new RegExp(`(^|[^a-z])${st}(?:'?s)?([^a-z]|$)`, "i") }));

/** A US state named in the text, placed at the centre of its bundled cities (region precision). */
export function usStateInText(text: string): HeadlinePlace | null {
  const lower = ` ${text.toLowerCase()} `;
  const us = COUNTRIES.find((c) => c.code === "US");
  if (!us) return null;
  for (const { st, re } of STATE_RES) {
    const m = re.exec(lower);
    if (!m) continue;
    const center = stateCenter(st);
    if (!center) continue;
    const name = st.replace(/\b\w/g, (x) => x.toUpperCase());
    const idx = m.index + m[1].length;
    return { name, country: us, city: { name, country: "US", countryName: us.name, admin1: st, lat: center[1], lon: center[0], population: 0, capital: false }, cued: CUE.test(lower.slice(Math.max(0, idx - 40), idx)), index: idx };
  }
  return null;
}

/** Approximate centres of widely reported seas, gulfs and straits (for events at sea). */
const SEAS: Array<{ name: string; lat: number; lon: number }> = [
  { name: "Caribbean Sea", lat: 15.0, lon: -75.0 },
  { name: "Mediterranean Sea", lat: 35.0, lon: 18.0 },
  { name: "Red Sea", lat: 20.0, lon: 38.5 },
  { name: "South China Sea", lat: 12.0, lon: 113.0 },
  { name: "East China Sea", lat: 29.0, lon: 125.0 },
  { name: "Black Sea", lat: 43.4, lon: 34.0 },
  { name: "Baltic Sea", lat: 58.0, lon: 20.0 },
  { name: "North Sea", lat: 56.0, lon: 3.0 },
  { name: "Arabian Sea", lat: 15.0, lon: 65.0 },
  { name: "Gulf of Aden", lat: 12.5, lon: 48.0 },
  { name: "Persian Gulf", lat: 26.5, lon: 52.0 },
  { name: "Strait of Hormuz", lat: 26.6, lon: 56.3 },
  { name: "Gulf of Mexico", lat: 25.0, lon: -90.0 },
  { name: "Taiwan Strait", lat: 24.5, lon: 119.5 },
  { name: "Sea of Japan", lat: 40.0, lon: 135.0 },
  { name: "Bay of Bengal", lat: 15.0, lon: 88.0 },
  { name: "Gulf of Guinea", lat: 2.0, lon: 3.0 },
  { name: "English Channel", lat: 50.2, lon: -1.0 },
  { name: "Strait of Malacca", lat: 4.0, lon: 100.5 },
  { name: "Bab-el-Mandeb", lat: 12.6, lon: 43.3 },
  { name: "Sea of Azov", lat: 46.0, lon: 36.5 },
  { name: "Aegean Sea", lat: 39.0, lon: 25.0 },
];
const SEA_RES = SEAS.map((sea) => ({ sea, re: new RegExp(`(^|[^a-z])${sea.name.toLowerCase().replace(/-/g, "[- ]")}([^a-z]|$)`, "i") }));

export interface SeaPlace {
  name: string;
  lat: number;
  lon: number;
  cued: boolean;
  index: number;
}

/** A sea, gulf or strait named in the text. */
export function seaInText(text: string): SeaPlace | null {
  const lower = ` ${text.toLowerCase()} `;
  let best: SeaPlace | null = null;
  for (const { sea, re } of SEA_RES) {
    const m = re.exec(lower);
    if (!m) continue;
    const idx = m.index + m[1].length;
    const place = { name: sea.name, lat: sea.lat, lon: sea.lon, cued: CUE.test(lower.slice(Math.max(0, idx - 40), idx)), index: idx };
    if (!best || place.index < best.index) best = place;
  }
  return best;
}
