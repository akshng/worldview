/**
 * Finds places named in a headline, used to sanity-check machine geocoding
 * (GDELT) and to give offshore events the country their source names.
 */
import "server-only";
import { CITIES, COUNTRIES, findCountryByName, regionsOf, type City, type Country } from "./gazetteer";

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

/** Lower-case and strip diacritics ("São Paulo" → "sao paulo"), keeping string length for ASCII text. */
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const COUNTRY_NAMES: Array<{ re: RegExp; country: Country; name: string }> = [];
const EXTRA_ALIASES: Record<string, string> = {
  "u.s.": "US", "u.s": "US", usa: "US", "united states": "US", america: "US", uk: "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB",
  russia: "RU", "south korea": "KR", "north korea": "KP", iran: "IR", syria: "SY", gaza: "PS", "west bank": "PS", palestine: "PS",
  turkiye: "TR", "türkiye": "TR", "u.k.": "GB", "s. korea": "KR", "n. korea": "KP",
  uae: "AE", "dr congo": "CD", "drc": "CD", "ivory coast": "CI", "czech republic": "CZ", burma: "MM", vietnam: "VN", laos: "LA", taiwan: "TW",
};
function add(name: string, country: Country | undefined) {
  if (!country || name.length < 4 && !["usa", "uk", "uae", "drc", "u.s"].includes(name)) return;
  const esc = escRe(fold(name));
  // URL-derived headlines lose apostrophes: "UK's" → "uks", "Yemen's" → "yemens".
  // Dotted abbreviations ("s. korea") must not start inside another ("u.s. korea policy").
  const lead = /^[a-z]\./.test(name) ? "[^a-z.]" : "[^a-z]";
  COUNTRY_NAMES.push({ re: new RegExp(`(^|${lead})${esc}(?:'?s)?([^a-z]|$)`, "i"), country, name });
}
for (const c of COUNTRIES) if (c.code.length === 2) for (const n of new Set([c.name, c.nameLong])) if (!AMBIGUOUS.has(n.toLowerCase())) add(n, c);
for (const [alias, code] of Object.entries(EXTRA_ALIASES)) add(alias, COUNTRIES.find((c) => c.code === code));

/** Current or local spellings of bundled cities (gazetteer name → extra spellings). */
const CITY_SPELLINGS: Record<string, string[]> = {
  Odessa: ["odesa"],
  "Nur-Sultan": ["astana"],
  Bengaluru: ["bangalore"],
  "Ho Chi Minh City": ["saigon"],
  Yangon: ["rangoon"],
  Sanaa: ["sana'a", "sana’a"],
};

const BIG_CITIES = CITIES.filter((c) => c.country && c.population >= 400_000 && c.name.length >= 4 && !AMBIGUOUS.has(c.name.toLowerCase()));
const CITY_RES = BIG_CITIES.flatMap((city) =>
  [...new Set([fold(city.name), ...(CITY_SPELLINGS[city.name] ?? [])])].map((n) => ({ city, re: new RegExp(`(^|[^a-z])${escRe(n)}([^a-z]|$)`, "i") })),
);

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
  const lower = ` ${fold(text)} `;
  const out: HeadlinePlace[] = [];
  const seen = new Set<string>();
  const cued = (idx: number) => CUE.test(lower.slice(Math.max(0, idx - 40), idx));
  const us = COUNTRIES.find((c) => c.code === "US")!;
  for (const { city, re } of CITY_RES) {
    const m = re.exec(lower);
    if (!m) continue;
    // "Vienna Georgia", "Paris Texas": a US town sharing a famous city's name.
    const after = lower.slice(m.index + m[0].length - (m[2] ? 1 : 0)).trimStart();
    // "bridge over the Dnipro River": the river, not the city.
    if (/^river\b/.test(after)) continue;
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
    if (!country || seen.has(`city:${city.name}`)) continue;
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

// ---------------------------------------------------------------------------
// Home-country places (for outlets with a strong home country)
// ---------------------------------------------------------------------------

/** Region/town names that are also everyday words or other famous places. */
const HOME_STOP = new Set([
  "delta", "rivers", "plateau", "niger", "central", "eastern", "western", "northern", "southern", "coast", "north west", "north-west",
  "free state", "saga", "para", "george", "worcester", "springbok", "amazonas", "distrito federal", "capital", "federal capital territory",
  "imo", "abia", "ondo", "kogi", "edo", "acre", "sind", "mexico", "buenos aires", "santa cruz", "san juan", "san luis", "la rioja", "cordoba",
  "hidalgo", "durango", "jersey", "victoria", "georgia", "washington", "nagano", "aichi",
]);
type PlaceSeed = Omit<HeadlinePlace, "cued" | "index">;
const homeCache = new Map<string, Array<{ re: RegExp; place: PlaceSeed }>>();
const stripMarks = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

function homeMatchers(code: string) {
  const hit = homeCache.get(code);
  if (hit) return hit;
  const country = COUNTRIES.find((c) => c.code === code);
  const out: Array<{ re: RegExp; place: PlaceSeed }> = [];
  if (country) {
    const countryNames = new Set([fold(country.name), fold(country.nameLong)]);
    const ok = (n: string) => n.length >= 4 && !HOME_STOP.has(fold(n)) && !AMBIGUOUS.has(fold(n)) && !countryNames.has(fold(n)) && !/[^\p{L}\s'’.-]/u.test(n);
    // Case-sensitive: the name must be capitalised in the headline.
    const re = (n: string) => new RegExp(`(^|[^\\p{L}])${escRe(stripMarks(n))}(?:['’]s)?(?![\\p{L}])`, "u");
    // Towns below the global 400k threshold (≥ 50k, or a capital).
    for (const city of CITIES) {
      if (city.country !== code || city.population >= 400_000 || (city.population < 50_000 && !city.capital) || !ok(city.name)) continue;
      out.push({ re: re(city.name), place: { name: city.name, country, city } });
    }
    // States / provinces / prefectures, placed at their label point (region precision).
    for (const r of regionsOf(code)) {
      const label = r.names[0];
      const city: City = { name: label, country: code, countryName: country.name, admin1: label, lat: r.lat, lon: r.lon, population: 0, capital: false };
      for (const n of new Set(r.names.filter((n) => ok(n) && !/\b(state|province|prefecture|city) of\b/i.test(n)))) {
        out.push({ re: re(n), place: { name: label, country, city } });
      }
    }
  }
  homeCache.set(code, out);
  return out;
}

/**
 * A town or state/province of `countryCode` named (capitalised) in the text, e.g. "Punjab"
 * in a Dawn headline → Punjab, Pakistan. Only for outlets whose home country this is:
 * "Punjab" is in India for The Hindu and in Pakistan for Dawn.
 */
export function homePlaceInText(text: string, countryCode: string): HeadlinePlace | null {
  const t = ` ${stripMarks(text)} `;
  const lower = t.toLowerCase();
  let best: HeadlinePlace | null = null;
  for (const { re, place } of homeMatchers(countryCode.toUpperCase())) {
    const m = re.exec(t);
    if (!m) continue;
    const idx = m.index + m[1].length;
    // Earliest wins; at the same spot a town beats a region of the same name.
    if (best && (best.index < idx || (best.index === idx && (best.city?.population ?? 0) >= (place.city?.population ?? 0)))) continue;
    best = { ...place, cued: CUE.test(lower.slice(Math.max(0, idx - 40), idx)), index: idx - 1 };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Demonyms ("Bulgarian PM says …")
// ---------------------------------------------------------------------------

/** Unambiguous, capitalised demonyms. Left out: American, Korean, Congolese, Guinean, Arab, African, English, Macedonian, Georgian, Dominican. */
const DEMONYMS: Record<string, string> = {
  Afghan: "AF", Albanian: "AL", Algerian: "DZ", Angolan: "AO", Argentine: "AR", Argentinian: "AR", Armenian: "AM", Australian: "AU", Austrian: "AT",
  Azerbaijani: "AZ", Azeri: "AZ", Bahraini: "BH", Bangladeshi: "BD", Belarusian: "BY", Belgian: "BE", Bolivian: "BO", Bosnian: "BA", Brazilian: "BR",
  British: "GB", Bulgarian: "BG", Burmese: "MM", Burkinabe: "BF", Cambodian: "KH", Cameroonian: "CM", Canadian: "CA", Chilean: "CL", Chinese: "CN",
  Colombian: "CO", "Costa Rican": "CR", Croatian: "HR", Cuban: "CU", Cypriot: "CY", Czech: "CZ", Danish: "DK", Dutch: "NL", Ecuadorian: "EC",
  Egyptian: "EG", Emirati: "AE", Eritrean: "ER", Estonian: "EE", Ethiopian: "ET", Fijian: "FJ", Filipino: "PH", Finnish: "FI", French: "FR",
  Gabonese: "GA", Gambian: "GM", German: "DE", Ghanaian: "GH", Greek: "GR", Guatemalan: "GT", Haitian: "HT", Honduran: "HN", Hungarian: "HU",
  Icelandic: "IS", Indian: "IN", Indonesian: "ID", Iranian: "IR", Iraqi: "IQ", Irish: "IE", Israeli: "IL", Italian: "IT", Ivorian: "CI",
  Jamaican: "JM", Japanese: "JP", Jordanian: "JO", Kazakh: "KZ", Kenyan: "KE", Kosovar: "XK", Kuwaiti: "KW", Kyrgyz: "KG", Latvian: "LV",
  Lebanese: "LB", Liberian: "LR", Libyan: "LY", Lithuanian: "LT", Malagasy: "MG", Malawian: "MW", Malaysian: "MY", Malian: "ML", Maltese: "MT",
  Mauritanian: "MR", Mexican: "MX", Moldovan: "MD", Mongolian: "MN", Montenegrin: "ME", Moroccan: "MA", Mozambican: "MZ", Namibian: "NA",
  Nepali: "NP", Nepalese: "NP", Nicaraguan: "NI", Nigerian: "NG", Nigerien: "NE", "North Korean": "KP", Norwegian: "NO", Omani: "OM",
  Pakistani: "PK", Palestinian: "PS", Panamanian: "PA", Paraguayan: "PY", Peruvian: "PE", Polish: "PL", Portuguese: "PT", Qatari: "QA",
  Romanian: "RO", Russian: "RU", Rwandan: "RW", Salvadoran: "SV", Saudi: "SA", Scottish: "GB", Senegalese: "SN", Serbian: "RS", Singaporean: "SG",
  Slovak: "SK", Slovenian: "SI", Somali: "SO", "South African": "ZA", "South Korean": "KR", "South Sudanese": "SS", Spanish: "ES",
  "Sri Lankan": "LK", Sudanese: "SD", Swedish: "SE", Swiss: "CH", Syrian: "SY", Taiwanese: "TW", Tajik: "TJ", Tanzanian: "TZ", Thai: "TH",
  Togolese: "TG", Tunisian: "TN", Turkish: "TR", Turkmen: "TM", Ugandan: "UG", Ukrainian: "UA", Uruguayan: "UY", Uzbek: "UZ", Venezuelan: "VE",
  Vietnamese: "VN", Welsh: "GB", Yemeni: "YE", Zambian: "ZM", Zimbabwean: "ZW", "S. Korean": "KR", "N. Korean": "KP",
};
const MODIFIER = "backed|led|made|owned|born|linked|funded|built|style|flagged|registered|based|bound|brokered|sponsored|allied|controlled|run";
// Longest first, so "South Sudanese" claims its span before "Sudanese".
const DEMONYM_RES = Object.entries(DEMONYMS)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([d, code]) => ({ d, code, re: new RegExp(`(^|[^A-Za-z.-])${escRe(d)}(?:e?s)?(?![A-Za-z]|-(?:${MODIFIER})\\b)`, "g") }));

/**
 * The country of the one nationality a headline names ("Bulgarian PM says ships hit").
 * Case-sensitive. Nothing when it names nationalities of two countries ("Ukrainian drones
 * hit Russian refinery") or uses one only as a modifier ("Saudi-backed", "Chinese-made").
 */
export function demonymInText(text: string): HeadlinePlace | null {
  let found: { code: string; index: number } | null = null;
  const taken: Array<[number, number]> = [];
  for (const { d, code, re } of DEMONYM_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const idx = m.index + m[1].length;
      if (taken.some(([a, b]) => idx >= a && idx < b)) continue;
      const before = text.slice(Math.max(0, idx - 9), idx);
      const after = text.slice(idx + d.length, idx + d.length + 12);
      if (d === "Indian" && /^ Ocean/.test(after)) continue;
      if (d === "Irish" && /Northern $/.test(before)) continue;
      if (d === "French" && /^ (?:Polynesia|Guiana|Riviera)/.test(after)) continue;
      taken.push([idx, idx + d.length]);
      if (found && found.code !== code) return null;
      if (!found || idx < found.index) found = { code, index: idx };
    }
  }
  if (!found) return null;
  const code = found.code;
  const country = COUNTRIES.find((c) => c.code === code);
  return country ? { name: country.name, country, city: null, cued: false, index: found.index } : null;
}
