import { describe, expect, it } from "vitest";
import { parseGoogleNews } from "@/lib/finance/stock-news";

const item = (title: string, source: string, link = "https://news.google.com/rss/articles/x") =>
  `<item><title>${title} - ${source}</title><link>${link}</link><pubDate>Tue, 27 Oct 2026 14:00:00 GMT</pubDate><source url="https://x">${source}</source></item>`;

describe("Google News headlines", () => {
  it("strips the publisher suffix, drops quote pages and duplicates", () => {
    const xml = `<rss><channel>${[
      item("Valero Energy Drops 6.2% After Broker Downgrades to Sell", "AlphaStreet"),
      item("Valero Energy Corporation (VLO) Stock Price, News, Quote &amp; History", "Yahoo Finance"),
      item("Valero Energy Drops 6.2% After Broker Downgrades to Sell", "Other"),
      item("Refiners slide as crack spreads narrow", "Reuters", "http://insecure"),
    ].join("")}</channel></rss>`;
    const h = parseGoogleNews(xml);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ title: "Valero Energy Drops 6.2% After Broker Downgrades to Sell", source: "AlphaStreet", published: "2026-10-27T14:00:00.000Z" });
  });
});
