/**
 * Recent headlines about one company from Google News RSS (keyless, unofficial).
 * Headlines only (title, publisher, time, link): enough to see why a stock moved.
 */

export interface Headline {
  title: string;
  source: string;
  published: string | null;
  url: string;
}

const NOISE = /(stock price, news, quote|share price, forecast|stock quote|price target, (news|forecast)|historical prices|stock chart|\bsec filings?\b list)/i;
const unxml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

export function parseGoogleNews(xml: string, max = 8): Headline[] {
  const out: Headline[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const raw = unxml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const source = unxml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
    // Google appends " - Publisher" to the title.
    const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
    const url = unxml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    const key = title.toLowerCase().slice(0, 60);
    if (!title || NOISE.test(title) || seen.has(key) || !/^https:\/\//.test(url)) continue;
    seen.add(key);
    out.push({ title, source: source || "Google News", published: pub ? new Date(pub).toISOString() : null, url });
    if (out.length >= max) break;
  }
  return out;
}

const cache = new Map<string, { at: number; v: Promise<Headline[]> }>();

export function stockHeadlines(company: string, days = 3): Promise<Headline[]> {
  return newsHeadlines(`"${company}" stock`, days);
}

/** Headlines for any topic ("Strait of Hormuz tanker", "Fed rate decision"). */
export function newsHeadlines(topic: string, days = 3): Promise<Headline[]> {
  const q = `${topic} when:${days}d`;
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.v;
  const v = fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  })
    .then((r) => (r.ok ? r.text() : ""))
    .then((x) => parseGoogleNews(x))
    .catch(() => {
      cache.delete(q);
      return [] as Headline[];
    });
  cache.set(q, { at: Date.now(), v });
  return v;
}
