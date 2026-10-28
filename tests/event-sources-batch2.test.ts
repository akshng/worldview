import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { zonedToUtc } from "@/data-sources/official-common";
import { easternStamp, parseNasdaqHalts, readHaltsXml } from "@/data-sources/nasdaq-halts";
import { ownerRole, parseForm4Atom, parseSecInsider, purchasesIn, splitSubmission, usd } from "@/data-sources/sec-insider-buys";
import { parseEcdc } from "@/data-sources/ecdc";
import { iaeaDate, parseIaea } from "@/data-sources/iaea";
import { parseVolcanicAsh, volcanoName, volcanoPosition, type IntlSigmet } from "@/data-sources/volcanic-ash";
import { easternIso, parseTreasuryAuctions, securityLabel, type TreasuryAuction } from "@/data-sources/treasury-auctions";
import { parseSecEnforcement, releaseNumber } from "@/data-sources/sec-enforcement";

const now = Date.parse("2026-10-28T23:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("registry (batch 2)", () => {
  it("registers the new connectors as live with polite intervals", () => {
    for (const id of ["nasdaq-halts", "sec-insider-buys", "sec-enforcement", "treasury-auctions", "ecdc", "iaea", "volcanic-ash"]) {
      const c = getConnector(id);
      expect(c?.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    }
  });
});

describe("zonedToUtc", () => {
  it("applies DST on both sides of a change", () => {
    expect(zonedToUtc("America/New_York", 2026, 10, 28, 15, 55, 1).toISOString()).toBe("2026-10-28T19:55:01.000Z"); // EDT
    expect(zonedToUtc("America/New_York", 2026, 12, 1, 9, 30).toISOString()).toBe("2026-12-01T14:30:00.000Z"); // EST
    expect(zonedToUtc("Europe/Vienna", 2026, 10, 28, 14, 21).toISOString()).toBe("2026-10-28T13:21:00.000Z"); // CET
    expect(zonedToUtc("Europe/Vienna", 2026, 10, 23, 15, 55).toISOString()).toBe("2026-10-23T13:55:00.000Z"); // CEST
  });
});

describe("Nasdaq trading halts", () => {
  const item = (sym: string, name: string, market: string, code: string, date: string, time: string, resDate = "", resTime = "") =>
    `<item><title>${sym}</title><pubDate>Wed, 28 Oct 2026 04:00:00 GMT</pubDate><ndaq:HaltDate>${date}</ndaq:HaltDate><ndaq:HaltTime>${time}</ndaq:HaltTime><ndaq:IssueSymbol>${sym}</ndaq:IssueSymbol><ndaq:IssueName>${name}</ndaq:IssueName><ndaq:Market>${market}</ndaq:Market><ndaq:ReasonCode>${code}</ndaq:ReasonCode><ndaq:PauseThresholdPrice />` +
    (resDate ? `<ndaq:ResumptionDate>${resDate}</ndaq:ResumptionDate><ndaq:ResumptionQuoteTime>${resTime}</ndaq:ResumptionQuoteTime><ndaq:ResumptionTradeTime>${resTime}</ndaq:ResumptionTradeTime>` : "<ndaq:ResumptionDate /><ndaq:ResumptionQuoteTime /><ndaq:ResumptionTradeTime />") +
    `<description><![CDATA[<table></table>]]></description></item>`;
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:ndaq="http://www.nasdaqtrader.com/"><channel><title>NASDAQTrader.com</title>
    ${item("REED", "Reed&apos;s, Inc. Common Stock", "AMEX", "T3", "10/28/2026", "13:17:22.542", "10/28/2026", "13:45:00")}
    ${item("FFTT", "Masonglory Ltd Ord A", "NASDAQ", "LUDP", "10/28/2026", "15:55:01.816", "10/28/2026", "16:00:00")}
    ${item("ZONE", "Zone Frontier Inc.", "AMEX", "H11", "10/19/2026", "01:47:35.541")}
    ${item("TJGC", "TJGC Grp Ltd Ord A", "NASDAQ", "H10", "10/14/2026", "19:50:00.000")}
    ${item("MAGH", "Magnitude International Ltd OS", "NASDAQ", "T12", "12/04/2025", "08:00:00.000")}
    ${item("GERN", "Geron Corporation", "NASDAQ", "T1", "10/20/2026", "07:55:00.000", "10/20/2026", "08:20:00")}
  </channel></rss>`;

  it("reads the ndaq: fields", () => {
    const h = readHaltsXml(xml);
    expect(h).toHaveLength(6);
    expect(h[0]).toMatchObject({ symbol: "REED", name: "Reed's, Inc. Common Stock", market: "AMEX", reasonCode: "T3", resumptionTradeTime: "13:45:00" });
    expect(h[2].resumptionDate).toBeNull();
    expect(easternStamp("10/28/2026", "13:17:22.542")).toBe("2026-10-28T17:17:22.000Z");
  });

  it("keeps news/regulatory halts, skips LULD pauses and stale ones", () => {
    const r = parseNasdaqHalts({ halts: readHaltsXml(xml) }, ctx);
    expect(r.candidates.map((c) => c.title)).toEqual([
      "Trading halt: Reed's, Inc. Common Stock (REED) — news and resumption times",
      "Trading halt: Zone Frontier Inc. (ZONE) — regulatory concern",
      "Trading halt: TJGC Grp Ltd Ord A (TJGC) — SEC trading suspension",
    ]);
    expect(r.skipped).toBe(3); // LULD pause, 2025 halt older than 14 days, resumed halt older than 3 days
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", subtype: "trading halt", timestamp: "2026-10-28T17:17:22.000Z", resolvedAt: "2026-10-28T17:45:00.000Z", locationName: "New York Stock Exchange, New York" });
    expect(r.candidates[1]).toMatchObject({ subtype: "regulatory halt", resolvedAt: null });
    expect(r.candidates[2].locationName).toBe("Nasdaq MarketSite, New York");
    expect(r.candidates[0].source.externalId).toBe("REED:2026-10-28T17:17:22.000Z");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("SEC Form 4 insider purchases", () => {
  const atom = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>4 - Keating Neal J. (0001234567) (Reporting)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1234567/000071782326000099/0000717823-26-000099-index.htm"/><updated>2026-10-28T17:30:03-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000717823-26-000099</id></entry>
<entry><title>4 - HEXCEL CORP /DE/ (0000717605) (Issuer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/717605/000071782326000099/0000717823-26-000099-index.htm"/><updated>2026-10-28T17:30:03-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000717823-26-000099</id></entry>
<entry><title>424B2 - BANK OF MONTREAL /CAN/ (0000927971) (Filer)</title><link href="https://www.sec.gov/x-index.htm"/><updated>2026-10-28T17:29:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0001214659-26-011111</id></entry>
<entry><title>4/A - ACME INC (0000000001) (Issuer)</title><link href="https://www.sec.gov/y-index.htm"/><updated>2026-10-28T17:28:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry>
</feed>`;
  const tx = (code: string, ad: string, shares: string, price: string, date = "2026-10-27") =>
    `<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${date}</value></transactionDate><transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>`;
  const doc = (txs: string, officer = "") =>
    `<ownershipDocument><documentType>4</documentType><issuer><issuerCik>0000717605</issuerCik><issuerName>HEXCEL CORP /DE/</issuerName><issuerTradingSymbol>HXL</issuerTradingSymbol></issuer>
    <reportingOwner><reportingOwnerId><rptOwnerCik>0001234567</rptOwnerCik><rptOwnerName>Keating Neal J.</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>${officer ? 1 : 0}</isOfficer><officerTitle>${officer}</officerTitle><isTenPercentOwner>0</isTenPercentOwner><isOther>0</isOther></reportingOwnerRelationship></reportingOwner>
    <nonDerivativeTable>${txs}</nonDerivativeTable></ownershipDocument>`;
  const submission = `<SEC-DOCUMENT>0000717823-26-000099.txt : 20261028
<SEC-HEADER>0000717823-26-000099.hdr.sgml : 20261028
ACCESSION NUMBER:		0000717823-26-000099

REPORTING-OWNER:\t

\tOWNER DATA:\t
\t\tCOMPANY CONFORMED NAME:\t\t\tKeating Neal J.

\tMAIL ADDRESS:\t
\t\tSTREET 1:\t\t1 OTHER ROAD
\t\tCITY:\t\t\tGREENWICH
\t\tSTATE:\t\t\tCT

ISSUER:\t\t

\tCOMPANY DATA:\t
\t\tCOMPANY CONFORMED NAME:\t\t\tHEXCEL CORP /DE/

\tBUSINESS ADDRESS:\t
\t\tSTREET 1:\t\tTWO STAMFORD PLAZA
\t\tCITY:\t\t\tSTAMFORD
\t\tSTATE:\t\t\tCT
\t\tZIP:\t\t\t06901

\tMAIL ADDRESS:\t
\t\tCITY:\t\t\tELSEWHERE
\t\tSTATE:\t\t\tNY
</SEC-HEADER>
<DOCUMENT><TYPE>4<TEXT><XML>
<?xml version="1.0"?>
${doc(tx("P", "A", "1,000", "121.5") + tx("P", "A", "1000", "120.5"), "")}
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;

  it("lists Form 4 issuer lines only, one per accession", () => {
    expect(parseForm4Atom(atom)).toEqual([
      { accession: "0000717823-26-000099", issuerCik: "0000717605", filedAt: "2026-10-28T17:30:03-04:00", url: "https://www.sec.gov/Archives/edgar/data/717605/000071782326000099/0000717823-26-000099-index.htm" },
    ]);
  });

  it("reads the issuer's business address (not the owner's or mail address)", () => {
    const s = splitSubmission(submission);
    expect(s).toMatchObject({ city: "STAMFORD", state: "CT" });
    expect(s.xml).toMatch(/^<ownershipDocument>/);
  });

  it("counts only open-market purchases", () => {
    const xml = doc(tx("P", "A", "500", "10") + tx("S", "D", "100", "10") + tx("A", "A", "100", "0") + tx("M", "A", "100", "5"));
    expect(purchasesIn(xml)).toEqual([{ date: "2026-10-27", shares: 500, price: 10, security: "Common Stock" }]);
    expect(ownerRole(doc("", "EVP &amp; CFO"))).toBe("EVP & CFO, director");
    expect(usd(242_000)).toBe("$242K");
    expect(usd(6_390_000)).toBe("$6.39M");
  });

  it("makes one event per filing with ≥ $100K of purchases, at the issuer's city", () => {
    const base = parseForm4Atom(atom)[0];
    const { city, state, xml } = splitSubmission(submission);
    const small = { ...base, accession: "0000717823-26-000100", city, state, xml: doc(tx("P", "A", "100", "50")) };
    const old = { ...base, accession: "0000717823-26-000101", filedAt: "2026-10-20T10:00:00-04:00", city, state, xml: xml! };
    const r = parseSecInsider({ filings: [{ ...base, city, state, xml: xml! }, small, old] }, ctx);
    expect(r.skipped).toBe(2);
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0];
    expect(c.title).toBe("Insider purchase: Keating Neal J. (director) bought $242K of HXL — HEXCEL CORP");
    expect(c).toMatchObject({ type: "MARKETS", subtype: "insider purchase", timestamp: "2026-10-28T21:30:03.000Z", geoPrecision: "region" }); // Stamford is not in the gazetteer: the state is used
    expect(c.locationName).toMatch(/^Stamford/);
    expect(c.metrics).toMatchObject({ ticker: "HXL", value_usd: 242000, shares: 2000, avg_price: 121 });
    expect(c.source.externalId).toBe("0000717823-26-000099");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("ECDC", () => {
  const ra = `<rss><channel><title>Risk assessment</title><item><title>Threat assessment brief – Importation of Ebola disease cases caused by Bundibugyo virus to Kenya and Nigeria</title><link>https://www.ecdc.europa.eu/en/publications-data/threat-assessment-brief-ebola-kenya-nigeria</link><description>&lt;p&gt;ECDC assesses the risk for the EU/EEA as very low.&lt;/p&gt;</description><pubDate>Fri, 23 Oct 2026 16:41:23 +0200</pubDate></item>
    <item><title>Rapid outbreak assessment – Salmonella linked to alfalfa sprouted seeds</title><link>https://www.ecdc.europa.eu/en/publications-data/roa-salmonella</link><pubDate>Thu, 25 Jun 2026 14:01:42 +0200</pubDate></item></channel></rss>`;
  const news = `<rss><channel><item><title>As the cold season nears, immunisation of newborns against RSV could reduce infant hospitalisations</title><link>https://www.ecdc.europa.eu/en/news-events/rsv</link><pubDate>Wed, 28 Oct 2026 10:02:07 +0100</pubDate></item>
    <item><title>ECDC Management Board meets in Stockholm</title><link>https://www.ecdc.europa.eu/en/news-events/mb</link><pubDate>Wed, 28 Oct 2026 09:00:00 +0100</pubDate></item>
    <item><title>Threat assessment brief – Importation of Ebola disease cases caused by Bundibugyo virus to Kenya and Nigeria</title><link>https://www.ecdc.europa.eu/en/publications-data/threat-assessment-brief-ebola-kenya-nigeria</link><pubDate>Fri, 23 Oct 2026 16:41:23 +0200</pubDate></item></channel></rss>`;

  it("labels publications, places them in the named country, else at ECDC", () => {
    const r = parseEcdc({ feeds: [{ feed: "news", items: parseFeedXml(news) }, { feed: "risk-assessment", items: parseFeedXml(ra) }] }, ctx);
    expect(r.candidates.map((c) => [c.title, c.country])).toEqual([
      ["ECDC risk assessment: Threat assessment brief – Importation of Ebola disease cases caused by Bundibugyo virus to Kenya and Nigeria", "KE"],
      ["ECDC: As the cold season nears, immunisation of newborns against RSV could reduce infant hospitalisations", "SE"],
    ]);
    expect(r.skipped).toBe(3); // old assessment, corporate item, duplicate link across feeds
    expect(r.candidates[0]).toMatchObject({ type: "HEALTH", subtype: "risk assessment", timestamp: "2026-10-23T14:41:23.000Z", geoPrecision: "country" });
    expect(r.candidates[1]).toMatchObject({ locationName: "ECDC, Solna (Stockholm)", geoPrecision: "city" });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("IAEA", () => {
  const xml = `<rss><channel><title>IAEA Top News</title>
    <item><title>Update 372 – IAEA Director General Statement on Situation in Ukraine</title><link>http://www.iaea.org/newscenter/pressreleases/update-372</link><description><![CDATA[]]></description><guid isPermaLink="false">290300</guid><pubDate>
26-10-23  15:55
</pubDate></item>
    <item><title>IAEA’s Grossi Calls for Progress in Deploying Nuclear Power as Ministerial Conference Opens</title><link>http://www.iaea.org/newscenter/news/grossi-ministerial</link><description>Director General Rafael Mariano Grossi called on countries…</description><pubDate>
26-10-27  09:00
</pubDate></item>
    <item><title>What is Nuclear Fuel?</title><link>http://www.iaea.org/newscenter/news/what-is-nuclear-fuel</link><pubDate>26-10-23  08:00</pubDate></item>
    <item><title>Photo essay: rice</title><link>http://www.iaea.org/news/photoessay/rice</link><pubDate>26-10-23  08:00</pubDate></item>
    <item><title>Old news item about reactors</title><link>http://www.iaea.org/newscenter/news/old</link><pubDate>26-09-01  08:00</pubDate></item>
  </channel></rss>`;

  it("reads Vienna-local dates", () => {
    expect(iaeaDate("26-10-23  15:55")).toBe("2026-10-23T13:55:00.000Z");
    expect(iaeaDate("Wed, 28 Oct 26 14:21:00 +0100")).toBe("2026-10-28T13:21:00.000Z");
  });

  it("keeps news and press releases, splits nuclear safety from science/policy", () => {
    const r = parseIaea({ items: parseFeedXml(xml) }, ctx);
    expect(r.skipped).toBe(3);
    expect(r.candidates.map((c) => [c.type, c.country, c.title])).toEqual([
      ["INFRASTRUCTURE", "UA", "Update 372 – IAEA Director General Statement on Situation in Ukraine"],
      ["SCIENCE", "AT", "IAEA’s Grossi Calls for Progress in Deploying Nuclear Power as Ministerial Conference Opens"],
    ]);
    expect(r.candidates[0].source.sourceUrl).toBe("https://www.iaea.org/newscenter/pressreleases/update-372");
    expect(r.candidates[1]).toMatchObject({ locationName: "IAEA, Vienna International Centre", timestamp: "2026-10-27T08:00:00.000Z" });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("volcanic ash SIGMETs", () => {
  const sig = (o: Partial<IntlSigmet>): IntlSigmet => ({
    icaoId: "RJTD", firId: "RJJJ", firName: "RJJJ FUKUOKA", receiptTime: "2026-10-28T18:13:50.717Z", validTimeFrom: Date.parse("2026-10-28T18:12:00Z") / 1000, validTimeTo: Date.parse("2026-10-29T00:12:00Z") / 1000,
    seriesId: "P02", hazard: "VA", qualifier: "ERUPTION MT SAKURAJIMA (AIRA CALDERA)", base: 0, top: 9000, dir: "E", spd: "10",
    coords: [{ lat: 31.6, lon: 130.65 }, { lat: 31.7, lon: 131 }, { lat: 31.4, lon: 131 }, { lat: 31.6, lon: 130.65 }],
    rawSigmet: "WVJP31 RJTD 281812\nRJJJ SIGMET P02 VALID 281812/290012 RJTD-\nRJJJ FUKUOKA FIR VA ERUPTION MT SAKURAJIMA (AIRA CALDERA) PSN N3136\nE13039 VA CLD OBS AT 1730Z WI N3136 E13039 - N3142 E13100 SFC/FL090 MOV E 10KT=",
    ...o,
  });

  it("reads the volcano name and position from the SIGMET text", () => {
    expect(volcanoName(sig({}).rawSigmet)).toBe("Sakurajima (Aira Caldera)");
    expect(volcanoName("MHTG SIGMET 3 VALID 281650/282250 MHTG- MHCC CENTRAL AMERICAN FIR VA FUEGO PSN N1428 W09052 VA CLD OBS")).toBe("Fuego");
    expect(volcanoName("SKED BOGOTA FIR VA MT VOLCAN PURACE PSN N0219 W07624")).toBe("Purace");
    expect(volcanoName("SCEZ SANTIAGO FIR VA ERUPTION MT NEVADOS DE CHILLAN PSN S3651 W07122")).toBe("Nevados de Chillan");
    expect(volcanoName("NZZC NEW ZEALAND FIR VA\nERUPTION MT WHAKAARI/WHITE ISLAND PSN S3731\nE17711")).toBe("Whakaari/White Island");
    expect(volcanoPosition(sig({}).rawSigmet)).toEqual({ lat: 31.6, lon: 130.65 });
    expect(volcanoPosition("PSN S0004 W07739")).toEqual({ lat: -0.067, lon: -77.65 });
  });

  it("groups successive SIGMETs per volcano and day, skipping forecast duplicates", () => {
    const later = sig({ seriesId: "P03", receiptTime: "2026-10-28T19:07:15.093Z", validTimeFrom: Date.parse("2026-10-28T19:06:00Z") / 1000, validTimeTo: Date.parse("2026-10-29T01:06:00Z") / 1000, top: 11000, rawSigmet: sig({}).rawSigmet.replace("P02", "P03") });
    const r = parseVolcanicAsh([sig({}), sig({ seriesId: "P02F" }), later, sig({ hazard: "TS" }), sig({ rawSigmet: "NO POSITION HERE" })], ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(4);
    const c = r.candidates[0];
    expect(c).toMatchObject({
      type: "VOLCANO",
      title: "Volcanic ash SIGMET: Sakurajima (Aira Caldera) — ash cloud up to FL110 (RJJJ FUKUOKA)",
      latitude: 31.6,
      longitude: 130.65,
      geoPrecision: "exact",
      timestamp: "2026-10-28T18:12:00.000Z",
    });
    expect(c.source.externalId).toBe("sakurajima-aira-caldera:2026-10-28");
    expect(c.source.assertion).toBe("OFFICIAL_PRELIMINARY");
    expect(c.geometry?.type).toBe("Polygon");
    expect(c.metrics).toMatchObject({ sigmets: 2, ash_top_ft: 11000 });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Treasury auction results", () => {
  const bill: TreasuryAuction = {
    cusip: "912797XB8", securityType: "Bill", securityTerm: "17-Week", competitiveAuctionCloseDate: "2026-10-28T00:00:00", competitiveAuctionCloseTime: "11:30 AM", updatedTimestamp: "2026-10-28T11:33:48",
    highYield: "", highRate: "4.140", investmentRate: "4.256", bidToCoverRatio: "3.08", offeringAmount: "75000000000", totalParAwardedInsideOfOfferingAmount: "75000228600",
    subtotalCompetitiveParAwardedInsideOfOfferingAmount: "74482698600", indirectBiddersCompetitiveParAwarded: "43156298600", reopening: "No", inflationProtected: "", floatingRate: "", cashManagementBill: "No", treasuryAuctionResultsPressReleaseFileName: "R_20261028_2.pdf",
  };
  const tips: TreasuryAuction = { ...bill, cusip: "91282CRR4", securityType: "Note", securityTerm: "5-Year", highRate: "", highYield: "2.367", investmentRate: "", bidToCoverRatio: "2.41", inflationProtected: "Yes", updatedTimestamp: "2026-10-22T14:49:14", competitiveAuctionCloseDate: "2026-10-22T00:00:00", treasuryAuctionResultsPressReleaseFileName: "R_20261022_4.pdf" };
  const frn: TreasuryAuction = { ...bill, cusip: "91282CRS2", securityType: "Note", securityTerm: "2-Year", highRate: "", highDiscountMargin: "0.038", bidToCoverRatio: "3.05", floatingRate: "Yes", updatedTimestamp: "2026-10-28T11:32:59" };
  const pending: TreasuryAuction = { ...bill, cusip: "912797ZZ9", highRate: "", bidToCoverRatio: "" };

  it("labels the security", () => {
    expect(securityLabel(tips)).toBe("5-Year TIPS");
    expect(securityLabel({ ...bill, reopening: "Yes" })).toBe("17-Week Bill (reopening)");
    expect(easternIso("2026-10-28T11:33:48")).toBe("2026-10-28T15:33:48.000Z");
  });

  it("makes one event per auction with published results", () => {
    const r = parseTreasuryAuctions([bill, tips, frn, pending, bill], ctx);
    expect(r.skipped).toBe(2);
    expect(r.candidates.map((c) => c.title)).toEqual([
      "Treasury auction: 17-Week Bill — high rate 4.140%, bid-to-cover 3.08",
      "Treasury auction: 5-Year TIPS — high yield 2.367%, bid-to-cover 2.41",
      "Treasury auction: 2-Year FRN — high discount margin 0.038%, bid-to-cover 3.05",
    ]);
    const c = r.candidates[0];
    expect(c).toMatchObject({ type: "MARKETS", subtype: "treasury auction", timestamp: "2026-10-28T15:33:48.000Z", country: "US" });
    expect(c.metrics).toMatchObject({ high_rate_pct: 4.14, bid_to_cover: 3.08, indirect_pct: 57.9 });
    expect(c.summary).toContain("indirect bidders took 57.9% of competitive awards");
    expect(c.source.sourceUrl).toBe("https://www.treasurydirect.gov/instit/annceresult/press/preanre/2026/R_20261028_2.pdf");
    expect(c.source.externalId).toBe("912797XB8:2026-10-28");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("SEC enforcement feeds", () => {
  const lit = `<rss><channel><item><title>Benjamin Conde</title><link>https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26677 </link><description>Benjamin Conde</description><pubDate>Wed, 21 Oct 2026 10:56:18 -0400</pubDate></item>
    <item><title>Old Person</title><link>https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26000</link><pubDate>Wed, 01 Jul 2026 10:00:00 -0400</pubDate></item></channel></rss>`;
  const ts = `<rss><channel><item><title>TJGC Group Limited</title><link>https://www.sec.gov/files/litigation/suspensions/2026/34-106668.pdf </link><pubDate>Wed, 14 Oct 2026 20:09:16 -0400</pubDate></item></channel></rss>`;
  const press = `<rss><channel><item><title>    SEC Charges Adviser With Cherry-Picking Scheme
</title><link>https://www.sec.gov/newsroom/press-releases/2026-110-sec-charges-adviser</link><description>The Securities and Exchange Commission today charged…</description><pubDate>Tue, 27 Oct 2026 10:10:00 -0400</pubDate></item>
    <item><title>  SEC Announces Fiscal Year 2027 Examination Priorities
</title><link>https://www.sec.gov/newsroom/press-releases/2026-109-sec-announces-priorities</link><pubDate>Fri, 23 Oct 2026 10:10:00 -0400</pubDate></item></channel></rss>`;

  it("reads release numbers from links", () => {
    expect(releaseNumber("https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26677")).toBe("LR-26677");
    expect(releaseNumber("https://www.sec.gov/files/litigation/admin/2026/ia-7028.pdf")).toBe("IA-7028");
    expect(releaseNumber("https://www.sec.gov/newsroom/press-releases/2026-109-x")).toBeNull();
  });

  it("titles each item by its kind of SEC action", () => {
    const r = parseSecEnforcement({ feeds: [{ feed: "suspension", items: parseFeedXml(ts) }, { feed: "litigation", items: parseFeedXml(lit) }, { feed: "press", items: parseFeedXml(press) }] }, ctx);
    expect(r.skipped).toBe(1);
    expect(r.candidates.map((c) => [c.subtype, c.title])).toEqual([
      ["trading suspension", "SEC trading suspension 34-106668: TJGC Group Limited"],
      ["litigation release", "SEC litigation release LR-26677: Benjamin Conde"],
      ["enforcement action", "SEC Charges Adviser With Cherry-Picking Scheme"],
      ["SEC press release", "SEC Announces Fiscal Year 2027 Examination Priorities"],
    ]);
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", timestamp: "2026-10-15T00:09:16.000Z", locationName: "U.S. SEC, Washington, DC" });
    expect(r.candidates[0].entities?.map((e) => e.name)).toContain("TJGC Group Limited");
    expect(r.candidates[1].source.externalId).toBe("litigation:LR-26677");
    expect(valid(r.candidates)).toBe(true);
  });
});
