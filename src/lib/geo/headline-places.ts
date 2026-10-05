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
