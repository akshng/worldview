import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { maxDollarAmount, parseAgencyFeeds, resolveLink } from "@/data-sources/agency-feeds/common";
import { defenseSpec, defenseSubtype } from "@/data-sources/defense-releases";
import { eiaSpec, eiaTopic } from "@/data-sources/eia-energy";
import { tradeSpec, tradeSubtype } from "@/data-sources/trade-policy";
import { medwatchSpec, medwatchSubtype } from "@/data-sources/fda-medwatch";
import { nasaCenter, nasaSpec } from "@/data-sources/nasa-news";
import { regulatorSubtype, regulatorsSpec } from "@/data-sources/market-regulators";
import { dojCaseKind, dojSpec } from "@/data-sources/doj-press";
import { ecDocKind, ecSpec, ecSubtype } from "@/data-sources/eu-commission";
import { censusPeriod, econSpec, indicatorOf } from "@/data-sources/us-economic-releases";
import { ifrcCategory, ifrcCountry, parseIfrc, type IfrcAppeal } from "@/data-sources/ifrc-appeals";

const now = Date.parse("2026-10-28T22:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);
const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
const item = (title: string, link: string, date: string, desc = "") =>
  `<item><title>${title}</title><link>${link}</link><description>${desc}</description><pubDate>${date}</pubDate></item>`;

const NEW_IDS = ["defense-releases", "eia-energy", "trade-policy", "fda-medwatch", "nasa-news", "market-regulators", "doj-press", "eu-commission", "us-economic-releases", "ifrc-appeals"];

describe("registry (agency feeds)", () => {
  it("registers the new connectors as live with sane refresh intervals", () => {
    for (const id of NEW_IDS) {
      const c = getConnector(id);
      expect(c, id).toBeDefined();
      expect(c!.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(15 * 60_000);
    }
  });
});

describe("agency-feeds common", () => {
  it("parses dollar amounts", () => {
    expect(maxDollarAmount("Charged in $49M Medicaid Fraud Scheme")).toBe(49e6);
    expect(maxDollarAmount("agrees to pay $1.2 billion and $350,000")).toBe(1.2e9);
    expect(maxDollarAmount("$5 more")).toBe(5);
    expect(maxDollarAmount("no money")).toBeNull();
  });
  it("resolves relative links and rejects non-http", () => {
    expect(resolveLink("/pressroom/releases/press593.php", "https://www.eia.gov/rss/press_rss.xml")).toBe("https://www.eia.gov/pressroom/releases/press593.php");
    expect(resolveLink("javascript:alert(1)", "https://www.eia.gov/")).toBeNull();
  });
});

describe("defense-releases", () => {
  const releases = rss(
    item("Readout of Secretary of War Pete Hegseth's Meeting With Indian Minister of Defence Rajnath Singh", "https://www.war.gov/News/Releases/Release/Article/4635195/readout/", "Wed, 28 Oct 2026 05:42:00 GMT") +
      item("Poland Selected to Host Historic PAC-3 Missile Maintenance Facility", "https://www.war.gov/News/Releases/Release/Article/4634000/poland/", "Tue, 27 Oct 2026 15:00:39 GMT") +
      item("Old release", "https://www.war.gov/News/Releases/Release/Article/1/old/", "Tue, 01 Sep 2026 15:00:00 GMT"),
  );
  const contracts = rss(
    item("\nContracts for Oct. 27, 2026\n", "https://www.war.gov/News/Contracts/Contract/Article/4634810/contracts-for-oct-27-2026/", "Tue, 27 Oct 2026 21:00:17 GMT", "Today's Department of War contracts valued at $7.5 million or more are now live on War.gov."),
  );
  it("keeps releases and the daily contract digest at the Pentagon", () => {
    const r = parseAgencyFeeds(defenseSpec, { feeds: [{ feed: "releases", items: parseFeedXml(releases) }, { feed: "contracts", items: parseFeedXml(contracts) }] }, ctx);
    expect(r.candidates.map((c) => c.title)).toEqual([
      "Readout of Secretary of War Pete Hegseth's Meeting With Indian Minister of Defence Rajnath Singh",
      "Department of War: Poland Selected to Host Historic PAC-3 Missile Maintenance Facility",
      "Department of War contract announcements — Oct. 27, 2026",
    ]);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ type: "POLITICS", subtype: "readout", country: "US", geoPrecision: "city" });
    expect(r.candidates[2]).toMatchObject({ type: "BUSINESS", subtype: "defense contracts", timestamp: "2026-10-27T21:00:17.000Z" });
    expect(r.candidates[0].source.id).toMatch(/^defense-releases:releases:/);
    expect(valid(r.candidates)).toBe(true);
  });
  it("labels release kinds", () => {
    expect(defenseSubtype("Statement by Chief Pentagon Spokesman")).toBe("statement");
    expect(defenseSubtype("General Officer Assignments")).toBe("personnel announcement");
  });
});

describe("eia-energy", () => {
  const today = rss(item("U.S. refineries have been running at very high rates in 2026", "https://www.eia.gov/todayinenergy/detail.php?id=68344", "Thu, 22 Oct 2026  09:00:00 EST"));
  const press = rss(item("EIA expects a mixed picture for winter fuel costs this year ", "/pressroom/releases/press593.php", "Tue, 20 Oct 2026 12:00:00 EST"));
  it("parses both feeds, double-spaced dates and relative links", () => {
    const r = parseAgencyFeeds(eiaSpec, { feeds: [{ feed: "today", items: parseFeedXml(today) }, { feed: "press", items: parseFeedXml(press) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toMatchObject({ title: "EIA: U.S. refineries have been running at very high rates in 2026", type: "MARKETS", subtype: "energy analysis", timestamp: "2026-10-22T14:00:00.000Z" });
    expect(r.candidates[1]).toMatchObject({ title: "EIA expects a mixed picture for winter fuel costs this year", subtype: "energy outlook" });
    expect(r.candidates[1].source.sourceUrl).toBe("https://www.eia.gov/pressroom/releases/press593.php");
    expect(valid(r.candidates)).toBe(true);
  });
  it("tags topics", () => {
    expect(eiaTopic("U.S. refineries running")).toBe("oil");
    expect(eiaTopic("LNG exports")).toBe("natural gas");
    expect(eiaTopic("Hybrid sales rise")).toBeNull();
  });
});

describe("trade-policy", () => {
  const wto = rss(
    item("Zimbabwe initiates safeguard investigation on pasta products", "https://www.wto.org/english/news_e/news26_e/safe_zwe_22oct26_523_e.htm", "Thu, 22 Oct 2026 00:00:00 GMT") +
      item("Members intensify discussions on WTO reform based on substantive proposals", "https://www.wto.org/english/news_e/news26_e/refrm_23oct26_524_e.htm", "Fri, 23 Oct 2026 00:00:00 GMT"),
  );
  const ustr = rss(
    item("USTR Announces Section 301 Tariff Action", "https://ustr.gov/about/policy-offices/press-office/press-releases/2026/october/x", "Wed, 28 Oct 2026 13:39:42 +0000") +
      item("Weekly Trade Focus: APEC", "https://ustr.gov/about-us/policy-offices/press-office/blog/weekly-trade-focus-apec", "Mon, 20 Jul 2009 18:28:39 +0000"),
  );
  it("places WTO items in the member named, USTR at its office", () => {
    const r = parseAgencyFeeds(tradeSpec, { feeds: [{ feed: "wto", items: parseFeedXml(wto) }, { feed: "ustr", items: parseFeedXml(ustr) }] }, ctx);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ title: "WTO: Zimbabwe initiates safeguard investigation on pasta products", type: "MARKETS", subtype: "trade remedy", country: "ZW", geoPrecision: "country" });
    expect(r.candidates[1]).toMatchObject({ type: "POLITICS", country: "CH", geoPrecision: "city" });
    expect(r.candidates[2]).toMatchObject({ subtype: "tariff action", country: "US" });
    expect(valid(r.candidates)).toBe(true);
  });
  it("classifies trade items", () => {
    expect(tradeSubtype("Panel report issued in DS597").subtype).toBe("trade dispute");
    expect(tradeSubtype("Trade Policy Review: Japan").subtype).toBe("trade policy review");
  });
});

describe("fda-medwatch", () => {
  const xml = rss(
    item("Early Alert: B. Braun Removes Streamline Bloodline Set for Dialog+", "http://www.fda.gov/medical-devices/medical-device-recalls-and-early-alerts/early-alert-b-braun", "Tue, 27 Oct 2026 00:00:00 EDT") +
      item("Par Health Issues Voluntary Nationwide Recall of Argatroban Injection", "http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/par-health", "Wed, 14 Oct 2026 00:00:00 EDT"),
  );
  it("parses alerts at FDA HQ", () => {
    const r = parseAgencyFeeds(medwatchSpec, { feeds: [{ feed: "medwatch", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates.map((c) => c.subtype)).toEqual(["device early alert", "product recall"]);
    expect(r.candidates[0]).toMatchObject({ type: "HEALTH", title: "FDA MedWatch: Early Alert: B. Braun Removes Streamline Bloodline Set for Dialog+", timestamp: "2026-10-27T04:00:00.000Z" });
    // Ids are stable across http/https variants of the same link.
    expect(r.candidates[0].source.externalId).toBe(
      parseAgencyFeeds(medwatchSpec, { feeds: [{ feed: "medwatch", items: parseFeedXml(xml.replace("http://www.fda.gov/medical", "https://www.fda.gov/medical")) }] }, ctx).candidates[0].source.externalId,
    );
    expect(valid(r.candidates)).toBe(true);
  });
  it("labels safety communications", () => {
    expect(medwatchSubtype("FDA warns about serious liver injury", "https://www.fda.gov/drugs/x")).toBe("safety communication");
  });
});

describe("nasa-news", () => {
  const xml = rss(
    item("NASA Welcomes Vietnam as Newest Artemis Accords Signatory", "https://www.nasa.gov/organizations/oiir/nasa-welcomes-vietnam/", "Wed, 28 Oct 2026 21:50:01 +0000") +
      item("Artemis III SLS Core Stage Joins Boosters at Kennedy", "https://www.nasa.gov/image-article/artemis-iii/", "Wed, 28 Oct 2026 18:59:44 +0000") +
      item("NASA Invites Media to Crew Completion of Yearlong Mars Simulation", "https://www.nasa.gov/news-release/nasa-invites-media/", "Tue, 27 Oct 2026 19:27:22 +0000") +
      item("NASA Awards Launch Service Contract", "https://www.nasa.gov/news-release/nasa-awards-launch/", "Tue, 27 Oct 2026 19:00:00 +0000"),
  );
  it("skips image posts and media advisories", () => {
    const r = parseAgencyFeeds(nasaSpec, { feeds: [{ feed: "releases", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates.map((c) => c.subtype)).toEqual(["NASA agreement", "NASA contract"]);
    expect(r.candidates.every((c) => c.type === "SPACE")).toBe(true);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
  });
  it("places at a named field centre only with a cue", () => {
    expect(nasaCenter("Core Stage Joins Boosters at Kennedy")?.name).toMatch(/Kennedy Space Center/);
    expect(nasaCenter("Johnson Space Center tests suits")?.name).toMatch(/Johnson/);
    expect(nasaCenter("Speaker Johnson comments on budget")).toBeNull();
  });
});

describe("market-regulators", () => {
  const cftc = rss(item("CFTC Charges Trader With $25 Million Spoofing Fraud", "https://www.cftc.gov/PressRoom/PressReleases/9317-26", "Tue, 27 Oct 2026 10:10:00 -0400"));
  const cftc2 = rss(item("CFTC to Host Roundtable on 24/7 Trading", "https://www.cftc.gov/PressRoom/PressReleases/9318-26", "Wed, 28 Oct 2026 17:00:53 +0000"));
  it("parses CFTC releases (SEC press releases come from sec-enforcement)", () => {
    expect(regulatorsSpec.feeds.map((f) => f.id)).toEqual(["cftc"]);
    const r = parseAgencyFeeds(regulatorsSpec, { feeds: [{ feed: "cftc", items: [...parseFeedXml(cftc), ...parseFeedXml(cftc2)] }] }, ctx);
    expect(r.candidates.find((c) => c.subtype === "enforcement action")).toMatchObject({ type: "MARKETS", metrics: { amount_usd: 25e6 } });
    expect(r.candidates.find((c) => c.subtype === "meeting")).toMatchObject({ locationName: expect.stringContaining("CFTC") });
    expect(valid(r.candidates)).toBe(true);
  });
  it("classifies releases", () => {
    expect(regulatorSubtype("SEC Adopts Amendments to Form PF")).toBe("rulemaking");
    expect(regulatorSubtype("SEC and AMF Announce Supervisory MOU")).toBe("international cooperation");
  });
});

describe("doj-press", () => {
  const xml = rss(
    item("Virginia Mental Health Professional Charged in $49M Medicaid Fraud Scheme", "https://www.justice.gov/opa/pr/virginia-x", "Wed, 28 Oct 2026 12:00:00 +0000") +
      item("American Woman Convicted of Receiving Military Training From ISIS in Syria", "https://www.justice.gov/opa/pr/isis-x", "Tue, 27 Oct 2026 12:00:00 +0000") +
      item("Man Sentenced for Assaulting Federal Officer", "https://www.justice.gov/opa/pr/assault-x", "Tue, 27 Oct 2026 12:00:00 +0000"),
  );
  it("keeps major cases only and places them from the headline", () => {
    const r = parseAgencyFeeds(dojSpec, { feeds: [{ feed: "opa", items: parseFeedXml(xml) }] }, ctx);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ type: "BUSINESS", country: "US", geoPrecision: "region", locationName: "Virginia, United States", metrics: { amount_usd: 49e6 } });
    expect(r.candidates[0].summary).toMatch(/presumed innocent/);
    expect(r.candidates[1]).toMatchObject({ type: "POLITICS", subtype: "national security case", country: "SY" });
    expect(valid(r.candidates)).toBe(true);
  });
  it("classifies cases", () => {
    expect(dojCaseKind("Company Agrees to Pay $3 Million to Resolve False Claims Act Allegations")).toBe("corporate");
    expect(dojCaseKind("Two Men Plead Guilty to $12 Million Wire Fraud")).toBe("corporate");
    expect(dojCaseKind("Man Sentenced for $40,000 Theft")).toBeNull();
  });
});

describe("eu-commission", () => {
  const xml = rss(
    item("Commission fines car makers €450 million in cartel case", "https://ec.europa.eu/commission/presscorner/detail/en/ip_26_2274", "Wed, 28 Oct 2026 10:00:00 GMT") +
      item("Joint statement by High Representative Kallas on the early parliamentary elections in Serbia", "https://ec.europa.eu/commission/presscorner/detail/en/statement_26_2275", "Tue, 27 Oct 2026 17:09:52 GMT") +
      item("Daily News 28 / 10 / 2026", "https://ec.europa.eu/commission/presscorner/detail/en/mex_26_2277", "Wed, 28 Oct 2026 10:22:18 GMT") +
      item("Commissioner's address at COP17", "https://ec.europa.eu/commission/presscorner/detail/en/speech_26_2280", "Wed, 28 Oct 2026 16:16:31 GMT"),
  );
  it("keeps press releases and statements, labels competition decisions", () => {
    const r = parseAgencyFeeds(ecSpec, { feeds: [{ feed: "presscorner", items: parseFeedXml(xml) }] }, ctx);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", subtype: "competition decision", country: "BE" });
    expect(r.candidates[1]).toMatchObject({ type: "POLITICS", country: "RS", geoPrecision: "country" });
    expect(valid(r.candidates)).toBe(true);
  });
  it("reads document kinds", () => {
    expect(ecDocKind("https://ec.europa.eu/commission/presscorner/detail/en/ip_26_2274")).toBe("ip");
    expect(ecDocKind("https://ec.europa.eu/commission/presscorner/detail/el/speech_26_2227")).toBeNull();
    expect(ecSubtype("Commission imposes anti-dumping duties on steel").subtype).toBe("trade measure");
  });
});

describe("us-economic-releases", () => {
  const census = rss(
    `<item><title>Advance U.S. International Trade in Goods</title><link>https://www.census.gov/econ/indicators/index.html</link><description><![CDATA[The advance international trade deficit in goods increased to $134.9 billion in September from $132.1 billion in August as imports increased more than exports.<p><br>September 2026: 2.1° % Change<br>August 2026: 11.1° % Change<br></p>]]></description><guid isPermaLink="false">adv_intl_trade</guid><pubDate>Wed, 28 Oct 2026 08:30:00 -0400</pubDate></item>` +
      `<item><title>Advance U.S. International Trade in Goods</title><link>https://www.census.gov/econ/indicators/index.html</link><description>older</description><pubDate>Thu, 24 Sep 2026 08:30:00 -0400</pubDate></item>`,
  );
  const bea = rss(item("GDP (Advance Estimate), 3rd Quarter 2026", "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026", "Tue, 27 Oct 2026 08:30:00 EDT", "Real gross domestic product (GDP) increased at an annual rate of 2.0 percent in the third quarter of 2026. More text."));
  it("titles Census releases with their period and quotes the release text", () => {
    const r = parseAgencyFeeds(econSpec, { feeds: [{ feed: "census", items: parseFeedXml(census) }, { feed: "bea", items: parseFeedXml(bea) }] }, ctx);
    expect(r.candidates.map((c) => c.title)).toEqual(["Census Bureau: Advance U.S. International Trade in Goods (September 2026)", "BEA: GDP (Advance Estimate), 3rd Quarter 2026"]);
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", timestamp: "2026-10-28T12:30:00.000Z", metrics: { indicator: "trade balance", period: "September 2026", market_moving: true } });
    expect(r.candidates[1].summary).toContain("annual rate of 2.0 percent");
    expect(r.candidates[1].metrics).toMatchObject({ indicator: "GDP" });
    expect(valid(r.candidates)).toBe(true);
  });
  it("keys Census releases by title and date (shared links)", () => {
    const a = parseAgencyFeeds(econSpec, { feeds: [{ feed: "census", items: parseFeedXml(census) }] }, { ...ctx, now: Date.parse("2026-09-25T00:00:00Z") });
    const b = parseAgencyFeeds(econSpec, { feeds: [{ feed: "census", items: parseFeedXml(census) }] }, ctx);
    expect(a.candidates[0].source.externalId).not.toBe(b.candidates[0].source.externalId);
  });
  it("reads periods and indicators", () => {
    expect(censusPeriod("rate ... 3rd Qtr 2026: +0.2* Percentage Points")).toBe("3rd Qtr 2026");
    expect(censusPeriod("August 2026 (r): +0.5 %")).toBe("August 2026");
    expect(indicatorOf("Advance Monthly Retail Sales")).toBe("retail sales");
    expect(indicatorOf("Advance Retail Inventories")).toBe("inventories");
  });
});

describe("ifrc-appeals", () => {
  const base: IfrcAppeal = {
    aid: "1",
    name: "Kenya-Floods-imminent DREF",
    code: "MDRKE074",
    atype_display: "DREF",
    status_display: "Active",
    dtype: { name: "Flood" },
    num_beneficiaries: 0,
    amount_requested: 80000,
    amount_funded: 80000,
    start_date: "2026-10-27T00:00:00Z",
    end_date: "2026-12-31T00:00:00Z",
    created_at: "2026-10-27 20:00:11.686045+00:00",
    event: null,
    country: { iso: "KE", iso3: "KEN", name: "Kenya" },
  };
  it("parses recent appeals at the country", () => {
    const r = parseIfrc(
      {
        results: [
          base,
          { ...base, aid: "2", code: "MDRSO028", name: "Somalia - Cholera Outbreak", dtype: { name: "Epidemic" }, country: { iso: null, name: "IFRC" }, event: 8110, num_beneficiaries: 36240 },
          { ...base, aid: "3", code: "MDRYE018", name: "Yemen - Population Movement", atype_display: "Emergency Appeal", start_date: "2026-08-01T00:00:00Z" },
          { ...base, aid: "4", code: "MDRXX001", name: "Nowhere", country: null },
        ],
      },
      ctx,
    );
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({ type: "FLOOD", title: "Kenya-Floods-imminent DREF (IFRC)", country: "KE", geoPrecision: "country", metrics: { amount_requested_chf: 80000, appeal_code: "MDRKE074" } });
    expect(r.candidates[0].summary).toContain("CHF 80,000 requested");
    expect(r.candidates[1]).toMatchObject({ type: "HEALTH", country: "SO", title: "Somalia - Cholera Outbreak (IFRC DREF)" });
    expect(r.candidates[1].source.sourceUrl).toBe("https://go.ifrc.org/emergencies/8110");
    expect(r.candidates[1].source.externalId).toBe("MDRSO028");
    expect(valid(r.candidates)).toBe(true);
  });
  it("maps types and countries", () => {
    expect(ifrcCategory("Earthquake")).toBe("EARTHQUAKE");
    expect(ifrcCategory("Population Movement")).toBe("DISASTER");
    expect(ifrcCountry({ code: "MDRZZ999", name: "Uganda - Drought", country: null })?.code).toBe("UG");
  });
});
