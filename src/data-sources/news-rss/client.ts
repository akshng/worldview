import { httpGet, type FetchContext } from "../types";
import { OUTLETS } from "./outlets";
import type { NewsRssRaw, Outlet, RssItem } from "./types";

export { OUTLETS };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

export function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1];
  }
  return null;
}

/** Minimal RSS 2.0 / RDF / Atom item reader (no external XML dependency). */
export function parseFeedXml(xml: string): RssItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const out: RssItem[] = [];
  for (const b of blocks) {
    const title = tag(b, ["title"]);
    let link = tag(b, ["link"]);
    if (!link || !decodeXmlText(link).trim()) {
      // Atom: <link rel="alternate" href="…"/> (rel defaults to alternate); never rel="self"/"enclosure".
      const links = [...b.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
      const pick = links.find((a) => !/\brel=["'](?!alternate)/i.test(a)) ?? null;
      link = pick?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
    }
    // RSS 1.0 (RDF) items without a <link> carry their URL in rdf:about.
    if (!link) link = b.match(/^<item\b[^>]*\brdf:about=["']([^"']+)["']/i)?.[1] ?? null;
    if (!title || !link) continue;
    const published = tag(b, ["pubDate", "dc:date", "published", "updated", "a10:updated"]);
    out.push({
      title: decodeXmlText(title).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      link: decodeXmlText(link).trim(),
      description: decodeXmlText(tag(b, ["description", "summary", "content:encoded", "content"]) ?? ""),
      // Some feeds wrap dates in CDATA (The Hindu).
      published: published ? decodeXmlText(published).trim() || null : null,
    });
  }
  return out;
}

/** Feeds fetched at once, and how long any one feed may take. */
const CONCURRENCY = 8;
const FEED_TIMEOUT_MS = 12_000;
/** Newest items kept per feed, so a few very busy feeds can't crowd out the rest. */
const MAX_ITEMS_PER_FEED = 60;

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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

export async function fetchNewsRss(ctx: FetchContext, outlets: Outlet[] = OUTLETS): Promise<NewsRssRaw> {
  // A slow or failing feed only loses itself; the run fails only if every feed does.
  const results = await mapLimited(outlets, CONCURRENCY, async (outlet) => {
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]);
    const res = await httpGet(outlet.url, { ...ctx, signal }, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    return { outlet, items: parseFeedXml(await res.text()).slice(0, MAX_ITEMS_PER_FEED) };
  });
  const feeds = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!feeds.length) {
    const reasons = results.map((r, i) => (r.status === "rejected" ? `${outlets[i].id}: ${(r.reason as Error)?.message ?? r.reason}` : null)).filter(Boolean);
    throw new Error(`No news feeds could be loaded (${reasons.slice(0, 4).join("; ")})`);
  }
  return { feeds };
}
