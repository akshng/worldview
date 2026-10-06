/**
 * Trends: what people are searching for, reading and sharing, as an attention signal
 * alongside world events. Keyless public sources only:
 *
 *  - Google Trends daily trending-searches RSS, per country
 *  - Wikimedia pageviews: most-read Wikipedia articles per language edition
 *  - Bluesky public AppView trending topics
 *  - Mastodon (mastodon.social) trending tags and links
 *  - Hacker News front page (Algolia API)
 *
 * Not included: X/Twitter (no free or keyless API; third-party scrapers are not used)
 * and Reddit (JSON endpoints return 403 without OAuth and robots.txt disallows all
 * automated access). Only aggregate trends and public titles are kept: no user
 * handles, avatars or other personal data. Cached 15 minutes; when a source fails the
 * last good copy is served and flagged as stale.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import { decodeXmlText } from "@/data-sources/news-rss/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrendNews {
  title: string;
  url: string;
  source: string | null;
}

export interface GoogleTrend {
  title: string;
  /** Google's approximate search-volume bucket, e.g. "2000+" */
  traffic: string | null;
  trafficValue: number | null;
  published: string | null;
  news: TrendNews[];
}

export interface GoogleCountry {
  geo: string;
  name: string;
  items: GoogleTrend[];
}

/** A search term trending in several countries at once. */
export interface CrossCountryTrend {
  title: string;
  geos: string[];
  /** Sum of the approximate traffic buckets across those countries */
  trafficValue: number;
  news: TrendNews[];
}

export interface WikiArticle {
  title: string;
  views: number;
  url: string;
}

export interface WikiLanguage {
  lang: string;
  name: string;
  /** UTC day the counts cover (YYYY-MM-DD) */
  date: string;
  articles: WikiArticle[];
}

export interface BlueskyTrend {
  title: string;
  description: string | null;
  postCount: number | null;
  /** "hot" | "cooling" | "stale" … as reported by Bluesky */
  status: string | null;
  category: string | null;
  startedAt: string | null;
  url: string;
}

export interface MastodonTag {
  name: string;
  url: string;
  /** Posts using the tag over the last two daily buckets */
  uses: number;
  accounts: number;
}

export interface MastodonLink {
  title: string;
  url: string;
  provider: string | null;
  description: string | null;
  uses: number;
  accounts: number;
}

export interface HnStory {
  title: string;
  url: string;
  hnUrl: string;
  points: number;
  comments: number;
  createdAt: string | null;
}

export interface Trends {
  google: GoogleCountry[];
  crossCountry: CrossCountryTrend[];
  wikipedia: WikiLanguage[];
  bluesky: BlueskyTrend[];
  mastodon: { instance: string; tags: MastodonTag[]; links: MastodonLink[] };
  hackernews: HnStory[];
  /** Sources (or parts of sources) with no data right now */
  failed: string[];
  /** Sources served from an earlier successful fetch because the latest one failed */
  stale: string[];
  generatedAt: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export const GOOGLE_GEOS: Record<string, string> = {
  US: "United States", GB: "United Kingdom", IN: "India", BR: "Brazil", JP: "Japan", DE: "Germany", FR: "France",
  CA: "Canada", AU: "Australia", MX: "Mexico", ID: "Indonesia", NG: "Nigeria", ZA: "South Africa", KR: "South Korea",
  TR: "Türkiye", IT: "Italy", ES: "Spain", NL: "Netherlands", PL: "Poland", AR: "Argentina", CO: "Colombia",
  EG: "Egypt", SA: "Saudi Arabia", PH: "Philippines", VN: "Vietnam", TH: "Thailand", MY: "Malaysia", SG: "Singapore",
  NZ: "New Zealand", IE: "Ireland", SE: "Sweden", NO: "Norway", UA: "Ukraine", IL: "Israel", KE: "Kenya",
  PK: "Pakistan", BD: "Bangladesh", TW: "Taiwan", HK: "Hong Kong", CL: "Chile", PE: "Peru",
};

export const WIKI_LANGS: Record<string, string> = {
  en: "English", es: "Spanish", de: "German", fr: "French", ja: "Japanese", ru: "Russian",
  it: "Italian", zh: "Chinese", pt: "Portuguese", pl: "Polish", ar: "Arabic", nl: "Dutch",
};

const MASTODON = "mastodon.social";
const TTL = 15 * 60_000;
const SITEINFO_TTL = 24 * 3600_000;
const CONCURRENCY = 6;
const WIKI_CONCURRENCY = 2;

// ─── Helpers ────────────────────────────────────────────────────────────────

const clean = (s: string) => decodeXmlText(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** "20000+" / "2,000+" / "10K+" / "1M+" → number. */
export function parseTraffic(s: string | null | undefined): number | null {
  const m = s?.replace(/[,\s]/g, "").match(/^(\d+(?:\.\d+)?)([KkMm])?\+?$/);
  if (!m) return null;
  const mult = m[2] ? (m[2].toUpperCase() === "K" ? 1e3 : 1e6) : 1;
  return Math.round(Number(m[1]) * mult);
}

/** Run `fn` over `items` with at most `limit` in flight. Never rejects; returns settled results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function get(url: string, accept = "application/json", retries = 1): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": `${userAgent()} trends`, Accept: accept },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status === 429 && retries > 0) {
    // One polite retry, honouring Retry-After (capped at 5 s).
    const wait = Math.min(5, Math.max(1, Number(res.headers.get("retry-after")) || 2));
    await new Promise((r) => setTimeout(r, wait * 1000));
    return get(url, accept, retries - 1);
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res;
}

// ─── Google Trends ──────────────────────────────────────────────────────────

/** Google Trends trending-searches RSS (trends.google.com/trending/rss?geo=XX). */
export function parseGoogleTrendsRss(xml: string, maxNews = 3): GoogleTrend[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  const out: GoogleTrend[] = [];
  for (const b of items) {
    const title = tag(b, "title");
    if (!title || !clean(title)) continue;
    const traffic = tag(b, "ht:approx_traffic");
    const news: TrendNews[] = [];
    for (const n of b.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/gi) ?? []) {
      const t = tag(n, "ht:news_item_title");
      const u = tag(n, "ht:news_item_url");
      if (!t || !u || !/^https?:\/\//i.test(clean(u))) continue;
      news.push({ title: clean(t), url: clean(u), source: tag(n, "ht:news_item_source") ? clean(tag(n, "ht:news_item_source")!) : null });
      if (news.length >= maxNews) break;
    }
    out.push({
      title: clean(title),
      traffic: traffic ? clean(traffic) : null,
      trafficValue: parseTraffic(traffic ? clean(traffic) : null),
      published: tag(b, "pubDate")?.trim() || null,
      news,
    });
  }
  return out;
}

/** Fold case, accents and punctuation so "Real Madrid" and "real madrid!" match. */
export function normalizeTerm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Terms trending in at least `minCountries` countries, most widespread first. */
export function crossCountryTrends(countries: GoogleCountry[], minCountries = 2, limit = 20): CrossCountryTrend[] {
  const groups = new Map<string, { title: string; best: number; geos: Set<string>; traffic: number; news: TrendNews[] }>();
  for (const c of countries) {
    for (const it of c.items) {
      const key = normalizeTerm(it.title);
      if (!key) continue;
      const g = groups.get(key) ?? { title: it.title, best: -1, geos: new Set<string>(), traffic: 0, news: [] };
      if (!g.geos.has(c.geo)) g.traffic += it.trafficValue ?? 0;
      g.geos.add(c.geo);
      if ((it.trafficValue ?? 0) > g.best) {
        g.best = it.trafficValue ?? 0;
        g.title = it.title;
        if (it.news.length) g.news = it.news.slice(0, 2);
      }
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.geos.size >= minCountries)
    .sort((a, b) => b.geos.size - a.geos.size || b.traffic - a.traffic)
    .slice(0, limit)
    .map((g) => ({ title: g.title, geos: [...g.geos], trafficValue: g.traffic, news: g.news }));
}

// ─── Wikipedia ──────────────────────────────────────────────────────────────

export interface WikiExclusions {
  mainPage: string;
  /** Lower-cased, underscore-joined names of every non-article namespace (localised, canonical and aliases) */
  prefixes: Set<string>;
}

const CANONICAL_NS = ["Media", "Special", "Talk", "User", "User talk", "Wikipedia", "Wikipedia talk", "Project", "File", "File talk", "Image", "MediaWiki", "MediaWiki talk", "Template", "Template talk", "Help", "Help talk", "Category", "Category talk", "Portal", "Portal talk", "Draft", "Draft talk", "Module", "Module talk", "TimedText", "Gadget", "Topic", "WP", "WT"];
const nsKey = (s: string) => s.replace(/ /g, "_").toLowerCase();

export const DEFAULT_WIKI_EXCLUSIONS: WikiExclusions = { mainPage: "Main_Page", prefixes: new Set(CANONICAL_NS.map(nsKey)) };

/**
 * Built-in main pages and the localised namespaces that show up in daily top lists, so
 * filtering still works when the siteinfo lookup is unavailable (e.g. rate-limited).
 */
const LOCAL_WIKI: Record<string, { main: string; ns: string[] }> = {
  en: { main: "Main_Page", ns: [] },
  es: { main: "Wikipedia:Portada", ns: ["Especial", "Archivo", "Categoría", "Plantilla", "Ayuda", "Usuario", "Usuaria"] },
  de: { main: "Wikipedia:Hauptseite", ns: ["Spezial", "Datei", "Kategorie", "Vorlage", "Hilfe", "Benutzer", "Benutzerin", "Diskussion"] },
  fr: { main: "Wikipédia:Accueil_principal", ns: ["Spécial", "Wikipédia", "Fichier", "Portail", "Catégorie", "Modèle", "Aide", "Utilisateur", "Utilisatrice", "Discussion"] },
  ja: { main: "メインページ", ns: ["特別", "ファイル", "利用者", "ノート"] },
  ru: { main: "Заглавная_страница", ns: ["Служебная", "Википедия", "Файл", "Портал", "Категория", "Шаблон", "Справка", "Участник", "Участница", "Обсуждение", "Проект"] },
  it: { main: "Pagina_principale", ns: ["Speciale", "Portale", "Categoria", "Aiuto", "Utente", "Discussione", "Progetto"] },
  zh: { main: "Wikipedia:首页", ns: ["特殊", "维基百科", "維基百科", "文件", "檔案", "分类", "分類", "模板", "帮助", "幫助", "用户", "使用者", "主题", "主題"] },
  pt: { main: "Wikipédia:Página_principal", ns: ["Especial", "Wikipédia", "Ficheiro", "Arquivo", "Categoria", "Predefinição", "Ajuda", "Usuário", "Utilizador", "Discussão"] },
  pl: { main: "Wikipedia:Strona_główna", ns: ["Specjalna", "Plik", "Kategoria", "Szablon", "Pomoc", "Wikipedysta", "Wikipedystka", "Dyskusja", "Wikiprojekt"] },
  ar: { main: "الصفحة_الرئيسة", ns: ["خاص", "ويكيبيديا", "ملف", "بوابة", "تصنيف", "قالب", "مساعدة", "مستخدم", "نقاش", "ميدياويكي"] },
  nl: { main: "Hoofdpagina", ns: ["Speciaal", "Bestand", "Portaal", "Categorie", "Sjabloon", "Gebruiker", "Overleg"] },
};

/** Built-in exclusions for a language edition (canonical English namespaces + known local names). */
export function wikiDefaults(lang: string): WikiExclusions {
  const local = LOCAL_WIKI[lang];
  const prefixes = new Set(DEFAULT_WIKI_EXCLUSIONS.prefixes);
  for (const n of local?.ns ?? []) prefixes.add(nsKey(n));
  return { mainPage: local?.main ?? "Main_Page", prefixes };
}

/** MediaWiki siteinfo (namespaces + aliases + general.mainpage) → exclusion rules, merged over the built-ins. */
export function parseSiteinfo(
  j: {
    query?: {
      general?: { mainpage?: string };
      namespaces?: Record<string, { id: number; name: string; canonical?: string }>;
      namespacealiases?: Array<{ id: number; alias: string }>;
    };
  },
  lang = "en",
): WikiExclusions {
  const base = wikiDefaults(lang);
  const prefixes = new Set(base.prefixes);
  for (const ns of Object.values(j.query?.namespaces ?? {})) {
    if (ns.id === 0) continue;
    if (ns.name) prefixes.add(nsKey(ns.name));
    if (ns.canonical) prefixes.add(nsKey(ns.canonical));
  }
  for (const a of j.query?.namespacealiases ?? []) if (a.id !== 0 && a.alias) prefixes.add(nsKey(a.alias));
  const main = j.query?.general?.mainpage;
  return { mainPage: main ? main.replace(/ /g, "_") : base.mainPage, prefixes };
}

export function isWikiArticle(article: string, ex: WikiExclusions): boolean {
  if (!article || article === "-" || article === ex.mainPage || article === "Main_Page") return false;
  const i = article.indexOf(":");
  if (i > 0 && ex.prefixes.has(article.slice(0, i).toLowerCase())) return false;
  return true;
}

/** Wikimedia REST pageviews/top response → articles (namespaces and main page removed). */
export function parseWikiTop(
  j: { items?: Array<{ articles?: Array<{ article: string; views: number }> }> },
  lang: string,
  ex: WikiExclusions = wikiDefaults(lang),
  limit = 25,
): WikiArticle[] {
  return (j.items?.[0]?.articles ?? [])
    .filter((a) => isWikiArticle(a.article, ex))
    .slice(0, limit)
    .map((a) => ({
      title: a.article.replace(/_/g, " "),
      views: int(a.views),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
    }));
}

// ─── Bluesky ────────────────────────────────────────────────────────────────

type RawBskyTrend = { topic?: string; displayName?: string; description?: string; link?: string; postCount?: number; status?: string; category?: string; startedAt?: string };

const bskyUrl = (link: string | undefined) => (link ? (/^https?:\/\//.test(link) ? link : `https://bsky.app${link.startsWith("/") ? "" : "/"}${link}`) : "https://bsky.app/");

/** app.bsky.unspecced.getTrends (or getTrendingTopics) → topics. Post authors ("actors") are dropped. */
export function parseBlueskyTrends(j: { trends?: RawBskyTrend[]; topics?: RawBskyTrend[] }): BlueskyTrend[] {
  return (j.trends ?? j.topics ?? [])
    .map((t) => ({
      title: (t.displayName || t.topic || "").trim(),
      description: t.description?.trim() || null,
      postCount: typeof t.postCount === "number" ? t.postCount : null,
      status: t.status ?? null,
      category: t.category ?? null,
      startedAt: t.startedAt ?? null,
      url: bskyUrl(t.link),
    }))
    .filter((t) => t.title);
}

// ─── Mastodon ───────────────────────────────────────────────────────────────

type MastoHistory = Array<{ day: string; uses: string; accounts: string }>;

const recent = (h: MastoHistory | undefined, days = 2) =>
  (h ?? []).slice(0, days).reduce((s, d) => ({ uses: s.uses + int(d.uses), accounts: s.accounts + int(d.accounts) }), { uses: 0, accounts: 0 });

export function parseMastodonTags(j: Array<{ name?: string; url?: string; history?: MastoHistory }>): MastodonTag[] {
  return (Array.isArray(j) ? j : [])
    .filter((t) => t.name)
    .map((t) => ({ name: t.name!, url: t.url || `https://${MASTODON}/tags/${encodeURIComponent(t.name!)}`, ...recent(t.history) }));
}

/** Trending links: title, URL and publisher only (author fields are dropped). */
export function parseMastodonLinks(j: Array<{ url?: string; title?: string; provider_name?: string; description?: string; history?: MastoHistory }>): MastodonLink[] {
  return (Array.isArray(j) ? j : [])
    .filter((l) => l.url && /^https?:\/\//.test(l.url) && l.title?.trim())
    .map((l) => ({
      title: l.title!.trim(),
      url: l.url!,
      provider: l.provider_name?.trim() || null,
      description: l.description?.trim() || null,
      ...recent(l.history),
    }));
}

// ─── Hacker News ────────────────────────────────────────────────────────────

/** Algolia HN search (tags=front_page) → stories by points. Submitter names are dropped. */
export function parseHackerNews(j: { hits?: Array<{ objectID: string; title?: string; url?: string | null; points?: number; num_comments?: number; created_at?: string }> }): HnStory[] {
  return (j.hits ?? [])
    .filter((h) => h.title)
    .map((h) => {
      const hnUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`;
      return { title: h.title!, url: h.url || hnUrl, hnUrl, points: int(h.points), comments: int(h.num_comments), createdAt: h.created_at ?? null };
    })
    .sort((a, b) => b.points - a.points);
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

async function fetchGoogle(geo: string): Promise<GoogleCountry> {
  const xml = await (await get(`https://trends.google.com/trending/rss?geo=${geo}`, "application/rss+xml, application/xml, text/xml")).text();
  const items = parseGoogleTrendsRss(xml);
  if (!items.length) throw new Error("empty feed");
  return { geo, name: GOOGLE_GEOS[geo] ?? geo, items };
}

const siteinfoCache = new Map<string, { at: number; value: WikiExclusions }>();

async function wikiExclusions(lang: string): Promise<WikiExclusions> {
  const hit = siteinfoCache.get(lang);
  if (hit && Date.now() - hit.at < SITEINFO_TTL) return hit.value;
  try {
    const j = await (await get(`https://${lang}.wikipedia.org/w/api.php?action=query&meta=siteinfo&siprop=general%7Cnamespaces%7Cnamespacealiases&format=json&formatversion=2`)).json();
    const value = parseSiteinfo(j, lang);
    siteinfoCache.set(lang, { at: Date.now(), value });
    return value;
  } catch {
    // Use the built-ins and retry in about an hour rather than on every refresh.
    const value = hit?.value ?? wikiDefaults(lang);
    siteinfoCache.set(lang, { at: Date.now() - SITEINFO_TTL + 3600_000, value });
    return value;
  }
}

const ymdPath = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

async function fetchWiki(lang: string): Promise<WikiLanguage> {
  const ex = await wikiExclusions(lang);
  // Daily tops are published some hours after midnight UTC: try yesterday, then the day before.
  for (const back of [1, 2]) {
    const day = new Date(Date.now() - back * 86_400_000);
    try {
      const j = await (await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${ymdPath(day)}`)).json();
      const articles = parseWikiTop(j, lang, ex);
      if (!articles.length) throw new Error("no articles");
      return { lang, name: WIKI_LANGS[lang] ?? lang, date: ymdPath(day).replace(/\//g, "-"), articles };
    } catch (err) {
      // Not yet published (404), or that day's list is throttled/erroring: fall back a day. The date is shown.
      const status = (err as { status?: number }).status ?? 0;
      if (back === 2 || !(status === 404 || status === 429 || status >= 500)) throw err;
    }
  }
  throw new Error("unreachable");
}

async function fetchBluesky(): Promise<BlueskyTrend[]> {
  let first: unknown;
  for (const ep of ["app.bsky.unspecced.getTrends", "app.bsky.unspecced.getTrendingTopics"]) {
    try {
      const out = parseBlueskyTrends(await (await get(`https://public.api.bsky.app/xrpc/${ep}?limit=25`)).json());
      if (out.length) return out;
    } catch (err) {
      first ??= err;
    }
  }
  throw first ?? new Error("no topics");
}

async function fetchMastodon(): Promise<Trends["mastodon"]> {
  const [tags, links] = await Promise.all([
    get(`https://${MASTODON}/api/v1/trends/tags?limit=20`).then((r) => r.json()).then(parseMastodonTags),
    get(`https://${MASTODON}/api/v1/trends/links?limit=20`).then((r) => r.json()).then(parseMastodonLinks),
  ]);
  if (!tags.length && !links.length) throw new Error("no trends");
  return { instance: MASTODON, tags, links };
}

async function fetchHackerNews(): Promise<HnStory[]> {
  const out = parseHackerNews(await (await get("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30")).json());
  if (!out.length) throw new Error("no stories");
  return out;
}

// ─── Cache + aggregate ──────────────────────────────────────────────────────

type Store = {
  at: number;
  value: Trends | null;
  inflight: Promise<Trends> | null;
  /** Last good copy per source key ("google:US", "wiki:en", "bluesky", …) */
  good: Map<string, unknown>;
};
const g = globalThis as unknown as { __worldviewTrends?: Store };
const store = (g.__worldviewTrends ??= { at: 0, value: null, inflight: null, good: new Map() });

async function build(): Promise<Trends> {
  const failed: string[] = [];
  const stale: string[] = [];
  /** Resolve a settled fetch, falling back to the last good copy. */
  const pick = <T>(key: string, label: string, r: PromiseSettledResult<T>): T | null => {
    if (r.status === "fulfilled") {
      store.good.set(key, r.value);
      return r.value;
    }
    const prev = store.good.get(key) as T | undefined;
    if (prev !== undefined) {
      stale.push(label);
      return prev;
    }
    failed.push(label);
    return null;
  };

  const geos = Object.keys(GOOGLE_GEOS);
  const langs = Object.keys(WIKI_LANGS);
  const [googleR, wikiR, single] = await Promise.all([
    mapLimit(geos, CONCURRENCY, fetchGoogle),
    // Wikimedia rate-limits bursts, so its edition fetches go two at a time.
    mapLimit(langs, WIKI_CONCURRENCY, fetchWiki),
    Promise.allSettled([fetchBluesky(), fetchMastodon(), fetchHackerNews()] as const),
  ]);

  const google = geos.map((geo, i) => pick(`google:${geo}`, `Google Trends (${geo})`, googleR[i])).filter((c): c is GoogleCountry => !!c);
  const wikipedia = langs.map((l, i) => pick(`wiki:${l}`, `Wikipedia (${l})`, wikiR[i])).filter((w): w is WikiLanguage => !!w);
  const bluesky = pick("bluesky", "Bluesky", single[0]) ?? [];
  const mastodon = pick("mastodon", "Mastodon", single[1]) ?? { instance: MASTODON, tags: [], links: [] };
  const hackernews = pick("hackernews", "Hacker News", single[2]) ?? [];

  // Collapse "Google Trends (XX)" × 41 into one line when the whole source is down.
  const collapse = (list: string[], prefix: string, total: number) => {
    const n = list.filter((f) => f.startsWith(prefix)).length;
    return n === total ? [...list.filter((f) => !f.startsWith(prefix)), `${prefix.trim()} (all)`] : list;
  };

  return {
    google,
    crossCountry: crossCountryTrends(google),
    wikipedia,
    bluesky,
    mastodon,
    hackernews,
    failed: collapse(collapse(failed, "Google Trends ", geos.length), "Wikipedia ", langs.length),
    stale,
    generatedAt: new Date().toISOString(),
  };
}

export async function getTrends(): Promise<Trends> {
  if (store.value && Date.now() - store.at < TTL) return store.value;
  store.inflight ??= build()
    .then((value) => {
      store.value = value;
      store.at = Date.now();
      return value;
    })
    .finally(() => {
      store.inflight = null;
    });
  return store.inflight;
}
