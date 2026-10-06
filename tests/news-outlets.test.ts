import { describe, expect, it } from "vitest";
import { fetchNewsRss, mapLimited, parseFeedXml } from "@/data-sources/news-rss/client";
import { OUTLETS } from "@/data-sources/news-rss/outlets";
import { parseNewsRss, placeFor } from "@/data-sources/news-rss/parser";
import { demonymInText, homePlaceInText, placesInText } from "@/lib/geo/headline-places";
import type { Outlet } from "@/data-sources/news-rss/types";

describe("news outlets list", () => {
  it("has unique ids, https feeds and regional balance", () => {
    expect(new Set(OUTLETS.map((o) => o.id)).size).toBe(OUTLETS.length);
    for (const o of OUTLETS) expect(o.url).toMatch(/^https:\/\//);
    const by = (r: Outlet["region"]) => OUTLETS.filter((o) => o.region === r).length;
    expect(by("asia")).toBeGreaterThanOrEqual(5);
    expect(by("middle-east")).toBeGreaterThanOrEqual(3);
    expect(by("africa")).toBeGreaterThanOrEqual(3);
    expect(by("latin-america")).toBeGreaterThanOrEqual(3);
    expect(by("europe")).toBeGreaterThanOrEqual(3);
  });
});

describe("feed formats", () => {
  it("reads CDATA-wrapped pubDate (The Hindu)", () => {
    const xml = `<rss><channel><item><title><![CDATA[ Karnataka to get new metro line ]]></title><link><![CDATA[https://www.thehindu.com/a]]></link>
      <pubDate><![CDATA[Tue, 06 Oct 2026 22:49:56 +0530]]></pubDate></item></channel></rss>`;
    const [it0] = parseFeedXml(xml);
    expect(it0).toMatchObject({ title: "Karnataka to get new metro line", link: "https://www.thehindu.com/a", published: "Tue, 06 Oct 2026 22:49:56 +0530" });
    expect(new Date(it0.published!).toISOString()).toBe("2026-10-06T17:19:56.000Z");
  });

  it("picks the Atom alternate link, not rel=self, and prefers <published>", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title type="html">Seoul &amp; Tokyo hold talks</title>
      <link rel="self" href="https://ex.com/self.xml"/><link rel="alternate" type="text/html" href="https://ex.com/story"/>
      <published>2026-10-06T10:00:00Z</published><updated>2026-10-06T12:00:00Z</updated>
      <content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeedXml(xml)[0]).toMatchObject({ title: "Seoul & Tokyo hold talks", link: "https://ex.com/story", published: "2026-10-06T10:00:00Z" });
  });

  it("takes an Atom link without rel, RDF dc:date, and rdf:about when <link> is missing", () => {
    expect(parseFeedXml(`<feed><entry><title>A headline here</title><link href="https://ex.com/x"/><updated>2026-10-06T12:00:00Z</updated></entry></feed>`)[0].link).toBe("https://ex.com/x");
    const rdf = `<rdf:RDF><item rdf:about="https://allafrica.com/stories/1.html"><title>Kenya: Exams begin</title><dc:date>2026-10-06T12:22:58Z</dc:date></item></rdf:RDF>`;
    expect(parseFeedXml(rdf)[0]).toMatchObject({ link: "https://allafrica.com/stories/1.html", published: "2026-10-06T12:22:58Z" });
  });

  it("parses media-namespace items and numeric offsets without a colon (Al-Monitor)", () => {
    const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Iraq vote count begins</title><link>https://www.al-monitor.com/x</link>
      <media:content url="https://img/x.jpg" medium="image"><media:title>photo</media:title></media:content>
      <pubDate>2026-10-06T12:46:34-0400</pubDate></item></channel></rss>`;
    const [it0] = parseFeedXml(xml);
    expect(it0.title).toBe("Iraq vote count begins");
    expect(new Date(it0.published!).toISOString()).toBe("2026-10-06T16:46:34.000Z");
  });
});

describe("fetching", () => {
  it("runs at most N at a time and keeps order, isolating failures", async () => {
    let active = 0;
    let peak = 0;
    const r = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      if (n === 4) throw new Error("boom");
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(r.map((x) => (x.status === "fulfilled" ? x.value : "x"))).toEqual([10, 20, 30, "x", 50, 60, 70]);
  });

  it("one failing feed never fails the run", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      String(url).includes("bad")
        ? new Response("nope", { status: 503 })
        : new Response(`<rss><item><title>Floods in Lagos today</title><link>https://ok/1</link><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate></item></rss>`)) as typeof fetch;
    try {
      const outlets: Outlet[] = [
        { id: "ok", name: "OK", url: "https://ok/feed", homepage: "h", region: "africa" },
        { id: "bad", name: "Bad", url: "https://bad/feed", homepage: "h", region: "africa" },
      ];
      const ctx = { signal: new AbortController().signal, lastSuccessAt: null, now: Date.now(), userAgent: "t", env: {} };
      const raw = await fetchNewsRss(ctx, outlets);
      expect(raw.feeds.map((f) => f.outlet.id)).toEqual(["ok"]);
      await expect(fetchNewsRss(ctx, [outlets[1]])).rejects.toThrow(/No news feeds/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("placement for regional outlets", () => {
  it("recognises a national outlet's own provinces and towns", () => {
    expect(placeFor("Punjab extends ban on gatherings until Oct 15", "", "PK")?.place).toMatchObject({ name: "Punjab", country: { code: "PK" } });
    expect(placeFor("Punjab extends ban on gatherings until Oct 15", "", "IN")?.place.country.code).toBe("IN");
    expect(placeFor("Police commissioner in Bayelsa orders crackdown on cult groups", "", "NG")?.place).toMatchObject({ name: "Bayelsa", country: { code: "NG" } });
    expect(placeFor("Koizumi to meet Okinawa governor after U.S. Marine's arrest", "", "JP")?.place).toMatchObject({ name: "Okinawa", country: { code: "JP" } });
    const p = placeFor("Milk price in Karnataka may go up", "", "IN")!.place;
    expect(p.city?.population).toBe(0); // region precision
  });

  it("never applies home places without a home, or to lower-case words", () => {
    expect(placeFor("Punjab extends ban on gatherings until Oct 15", "")).toBeNull();
    expect(homePlaceInText("rivers burst their banks after delta storms", "NG")).toBeNull();
    expect(homePlaceInText("Nigeria's oil Delta and Rivers communities", "NG")).toBeNull(); // stop-listed names
    expect(homePlaceInText("New study on sleep", "IN")).toBeNull();
  });

  it("a cued foreign place still beats a home place", () => {
    expect(placeFor("Punjab minister meets investors in Dubai", "", "PK")?.place.name).toBe("Dubai");
  });

  it("places by a single nationality, but not two or a modifier", () => {
    expect(demonymInText("Bulgarian Prime Minister says vessels hit by drones")?.country.code).toBe("BG");
    expect(demonymInText("Australian opposition vows 'biggest cut to immigration'")?.country.code).toBe("AU");
    expect(demonymInText("Saudi-backed Yemeni forces expel the Houthis")?.country.code).toBe("YE");
    expect(demonymInText("South Sudanese refugees return home")?.country.code).toBe("SS");
    expect(demonymInText("S. Korean won rises slightly")?.country.code).toBe("KR");
    expect(demonymInText("Ukrainian drones hit Russian refinery")).toBeNull();
    expect(demonymInText("Chinese-made drones seized")).toBeNull();
    expect(demonymInText("Storms over the Indian Ocean")).toBeNull();
    expect(demonymInText("Workers polish the hull")).toBeNull();
    expect(placeFor("Indian opposition marches in protest seeking resignation", "")?.place.country.code).toBe("IN");
  });

  it("handles local spellings and abbreviations", () => {
    expect(placesInText("Strikes on Odesa port")[0]?.name).toBe("Odessa");
    expect(placesInText("Floods in Sao Paulo")[0]?.name).toBe("São Paulo");
    expect(placesInText("U.S. withdraws bombers from U.K. base").map((p) => [p.country.code, p.cued])).toContainEqual(["GB", true]);
    expect(placesInText("S. Korea beat Uzbekistan")[0]?.country.code).toBe("KR");
    expect(placesInText("U.S. Korea policy review").map((p) => p.country.code)).not.toContain("KR");
    expect(placesInText("Russia strikes bridge over Dnipro River").map((p) => p.name)).not.toContain("Dnipro");
  });

  it("parses a regional feed end to end with the outlet's home country", () => {
    const outlet: Outlet = { id: "dawn", name: "Dawn", url: "u", homepage: "h", region: "asia", home: "PK" };
    const now = Date.parse("2026-10-06T18:00:00Z");
    const r = parseNewsRss(
      {
        feeds: [{ outlet, items: [
          { title: "Punjab extends ban on gatherings until Oct 15", link: "https://www.dawn.com/news/1", description: "", published: "Tue, 06 Oct 2026 21:31:18 +0500" },
          { title: "IMF talks likely to clear way for disbursement", link: "https://www.dawn.com/news/2", description: "", published: "Tue, 06 Oct 2026 21:31:18 +0500" },
        ] }],
      },
      { now, retrievedAt: new Date(now).toISOString() },
    );
    expect(r.skipped).toBe(1); // unlocatable headline still skipped
    expect(r.candidates[0]).toMatchObject({ locationName: "Punjab, Pakistan", country: "PK", geoPrecision: "region" });
  });
});
