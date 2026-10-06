import { describe, expect, it } from "vitest";
import {
  crossCountryTrends,
  isWikiArticle,
  mapLimit,
  normalizeTerm,
  parseBlueskyTrends,
  parseGoogleTrendsRss,
  parseHackerNews,
  parseMastodonLinks,
  parseMastodonTags,
  parseSiteinfo,
  parseTraffic,
  parseWikiTop,
  wikiDefaults,
  type GoogleCountry,
} from "@/lib/trends";

const GT_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<title>Daily Search Trends</title>
<item>
  <title>argentina vs benin</title>
  <ht:approx_traffic>20000+</ht:approx_traffic>
  <description/>
  <link>https://trends.google.com/trending/rss?geo=US</link>
  <pubDate>Mon, 5 Oct 2026 23:00:00 -0700</pubDate>
  <ht:picture>https://example.com/p.jpg</ht:picture>
  <ht:news_item>
    <ht:news_item_title>Argentina &amp; Benin draw &#8217;friendly&#8217;</ht:news_item_title>
    <ht:news_item_snippet/>
    <ht:news_item_url>https://news.example.com/a</ht:news_item_url>
    <ht:news_item_source>Example News</ht:news_item_source>
  </ht:news_item>
  <ht:news_item>
    <ht:news_item_title>Bad link</ht:news_item_title>
    <ht:news_item_url>javascript:alert(1)</ht:news_item_url>
  </ht:news_item>
</item>
<item>
  <title><![CDATA[café]]></title>
  <ht:approx_traffic>2,000+</ht:approx_traffic>
  <pubDate>Mon, 5 Oct 2026 22:00:00 -0700</pubDate>
</item>
<item><title>  </title></item>
</channel></rss>`;

describe("Google Trends RSS", () => {
  it("parses titles, traffic, dates and news items", () => {
    const items = parseGoogleTrendsRss(GT_RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "argentina vs benin", traffic: "20000+", trafficValue: 20000, published: "Mon, 5 Oct 2026 23:00:00 -0700" });
    expect(items[0].news).toEqual([{ title: "Argentina & Benin draw ’friendly’", url: "https://news.example.com/a", source: "Example News" }]);
    expect(items[1]).toMatchObject({ title: "café", trafficValue: 2000, news: [] });
  });

  it("parses traffic buckets", () => {
    expect(parseTraffic("200+")).toBe(200);
    expect(parseTraffic("2,000+")).toBe(2000);
    expect(parseTraffic("10K+")).toBe(10000);
    expect(parseTraffic("1.5M+")).toBe(1_500_000);
    expect(parseTraffic("lots")).toBeNull();
    expect(parseTraffic(null)).toBeNull();
  });

  it("finds terms trending in several countries", () => {
    const mk = (geo: string, titles: Array<[string, number]>): GoogleCountry => ({
      geo,
      name: geo,
      items: titles.map(([title, v]) => ({ title, traffic: `${v}+`, trafficValue: v, published: null, news: [] })),
    });
    const out = crossCountryTrends([
      mk("US", [["Real Madrid", 1000], ["local thing", 500]]),
      mk("MX", [["real madrid", 5000], ["NBA", 200]]),
      mk("BR", [["Réal Madrid!", 200], ["nba", 100]]),
    ]);
    expect(out.map((c) => c.title)).toEqual(["real madrid", "NBA"]);
    expect(out[0].geos).toEqual(["US", "MX", "BR"]);
    expect(out[0].trafficValue).toBe(6200);
    expect(normalizeTerm("Réal  Madrid!")).toBe("real madrid");
  });
});

describe("Wikipedia", () => {
  const top = {
    items: [
      {
        articles: [
          { article: "Wikipedia:Hauptseite", views: 900000, rank: 1 },
          { article: "Spezial:Suche", views: 500000, rank: 2 },
          { article: "Tatort:_Explosive_Mischung", views: 90000, rank: 3 },
          { article: "Datei:Foo.jpg", views: 80000, rank: 4 },
          { article: "Lothar_Matthäus", views: 70000, rank: 5 },
          { article: "-", views: 60000, rank: 6 },
        ],
      },
    ],
  };

  it("removes the main page and namespaces using built-in local names", () => {
    const out = parseWikiTop(top, "de");
    expect(out.map((a) => a.title)).toEqual(["Tatort: Explosive Mischung", "Lothar Matthäus"]);
    expect(out[1]).toEqual({ title: "Lothar Matthäus", views: 70000, url: "https://de.wikipedia.org/wiki/Lothar_Matth%C3%A4us" });
  });

  it("merges siteinfo namespaces, aliases and main page", () => {
    const ex = parseSiteinfo(
      {
        query: {
          general: { mainpage: "Hoofdpagina" },
          namespaces: { "0": { id: 0, name: "" }, "-1": { id: -1, name: "Speciaal", canonical: "Special" }, "100": { id: 100, name: "Nieuw Ding" } },
          namespacealiases: [{ id: 4, alias: "WP" }],
        },
      },
      "nl",
    );
    expect(ex.mainPage).toBe("Hoofdpagina");
    expect(isWikiArticle("Hoofdpagina", ex)).toBe(false);
    expect(isWikiArticle("Speciaal:Zoeken", ex)).toBe(false);
    expect(isWikiArticle("Nieuw_Ding:Iets", ex)).toBe(false);
    expect(isWikiArticle("Main_Page", ex)).toBe(false);
    expect(isWikiArticle("Star_Wars:_Episode_IV", ex)).toBe(true);
    expect(wikiDefaults("en").mainPage).toBe("Main_Page");
  });
});

describe("Bluesky", () => {
  it("parses getTrends and drops actors", () => {
    const out = parseBlueskyTrends({
      trends: [
        {
          topic: "abc",
          displayName: "Plague death reported in Siberia",
          description: "A lab worker…",
          link: "/profile/did:plc:x/feed/abc",
          postCount: 4462,
          status: "hot",
          category: "science-tech",
          startedAt: "2026-10-05T10:00:00Z",
          actors: [{ handle: "someone.bsky.social" }],
        } as never,
        { topic: "" },
      ],
    });
    expect(out).toEqual([
      {
        title: "Plague death reported in Siberia",
        description: "A lab worker…",
        postCount: 4462,
        status: "hot",
        category: "science-tech",
        startedAt: "2026-10-05T10:00:00Z",
        url: "https://bsky.app/profile/did:plc:x/feed/abc",
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("someone");
  });

  it("falls back to getTrendingTopics shape", () => {
    expect(parseBlueskyTrends({ topics: [{ topic: "Election", link: "/search?q=Election" }] })[0]).toMatchObject({ title: "Election", postCount: null, url: "https://bsky.app/search?q=Election" });
  });
});

describe("Mastodon", () => {
  const history = [
    { day: "1791244800", uses: "12", accounts: "10" },
    { day: "1791158400", uses: "181", accounts: "170" },
    { day: "1791072000", uses: "999", accounts: "999" },
  ];
  it("sums the last two days of tag usage", () => {
    expect(parseMastodonTags([{ name: "MonochromeMonday", url: "https://mastodon.social/tags/monochromemonday", history }, { url: "x" }])).toEqual([
      { name: "MonochromeMonday", url: "https://mastodon.social/tags/monochromemonday", uses: 193, accounts: 180 },
    ]);
  });
  it("parses links without author fields", () => {
    const out = parseMastodonLinks([
      { url: "https://www.propublica.org/a", title: " How reporters… ", provider_name: "ProPublica", description: "d", history, author_name: "Jane Doe" } as never,
      { url: "ftp://bad", title: "x" },
      { url: "https://ok.example", title: "" },
    ]);
    expect(out).toEqual([{ title: "How reporters…", url: "https://www.propublica.org/a", provider: "ProPublica", description: "d", uses: 193, accounts: 180 }]);
    expect(JSON.stringify(out)).not.toContain("Jane");
  });
});

describe("Hacker News", () => {
  it("parses Algolia hits, sorts by points and drops authors", () => {
    const out = parseHackerNews({
      hits: [
        { objectID: "1", title: "Ask HN: something", url: null, points: 50, num_comments: 10, created_at: "2026-10-05T00:00:00Z", author: "pg" } as never,
        { objectID: "2", title: "Web Search API", url: "https://example.com/x", points: 521, num_comments: 237 },
        { objectID: "3" },
      ],
    });
    expect(out.map((h) => h.title)).toEqual(["Web Search API", "Ask HN: something"]);
    expect(out[1]).toEqual({ title: "Ask HN: something", url: "https://news.ycombinator.com/item?id=1", hnUrl: "https://news.ycombinator.com/item?id=1", points: 50, comments: 10, createdAt: "2026-10-05T00:00:00Z" });
    expect(JSON.stringify(out)).not.toContain("pg");
  });
});

describe("mapLimit", () => {
  it("bounds concurrency and keeps order, capturing failures", async () => {
    let active = 0;
    let peak = 0;
    const res = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (n === 4) throw new Error("boom");
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(res.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([2, 4, 6, "x", 10, 12, 14]);
  });
});
