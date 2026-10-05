import { httpGet, type FetchContext } from "../types";
import type { NewsRssRaw, Outlet, RssItem } from "./types";

/** International desks of major outlets with public RSS feeds. Headlines, short summaries and links only. */
export const OUTLETS: Outlet[] = [
  { id: "bbc", name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", homepage: "https://www.bbc.com/news/world" },
  { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", homepage: "https://www.aljazeera.com/" },
  { id: "npr", name: "NPR", url: "https://feeds.npr.org/1004/rss.xml", homepage: "https://www.npr.org/sections/world/" },
  { id: "dw", name: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-en-world", homepage: "https://www.dw.com/en/world/" },
  { id: "france24", name: "France 24", url: "https://www.france24.com/en/rss", homepage: "https://www.france24.com/en/" },
  { id: "un", name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", homepage: "https://news.un.org/en/" },
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss", homepage: "https://www.theguardian.com/world" },
  { id: "cnbc", name: "CNBC", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html", homepage: "https://www.cnbc.com/world/" },
  { id: "sky", name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", homepage: "https://news.sky.com/world" },
  { id: "abc-au", name: "ABC News (Australia)", url: "https://www.abc.net.au/news/feed/2942460/rss.xml", homepage: "https://www.abc.net.au/news" },
];

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
    if (!link || !link.trim()) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? null; // Atom
    if (!title || !link) continue;
    out.push({
      title: decodeXmlText(title).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      link: decodeXmlText(link).trim(),
      description: decodeXmlText(tag(b, ["description", "summary", "content:encoded"]) ?? ""),
      published: tag(b, ["pubDate", "dc:date", "updated", "published"])?.trim() ?? null,
    });
  }
  return out;
}

export async function fetchNewsRss(ctx: FetchContext): Promise<NewsRssRaw> {
  const results = await Promise.allSettled(
    OUTLETS.map(async (outlet) => ({ outlet, items: parseFeedXml(await (await httpGet(outlet.url, ctx, { accept: "application/rss+xml, application/xml, text/xml" })).text()) })),
  );
  const feeds = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!feeds.length) {
    const reasons = results.map((r, i) => (r.status === "rejected" ? `${OUTLETS[i].id}: ${(r.reason as Error)?.message ?? r.reason}` : null)).filter(Boolean);
    throw new Error(`No news feeds could be loaded (${reasons.slice(0, 4).join("; ")})`);
  }
  return { feeds };
}
