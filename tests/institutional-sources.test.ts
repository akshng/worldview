import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { CENTRAL_BANKS, classifyRelease, parseCentralBanks } from "@/data-sources/central-banks";
import { parseDelta, parseOfac } from "@/data-sources/ofac-sanctions";
import { parseSanctionsNews } from "@/data-sources/sanctions-news";
import { parseAppStatus, parseAwsRss, parseCloudStatus, placeFromPop, regionPlace } from "@/data-sources/status-pages";
import { fdaDate, parseFdaRecalls, productName } from "@/data-sources/fda-recalls";
import { parseCpsc } from "@/data-sources/cpsc-recalls";
import { parseRansomware } from "@/data-sources/ransomware-live";
import { countryOfDomain, parseHibp } from "@/data-sources/hibp-breaches";
import { parseUnPress, unBody } from "@/data-sources/un-press";

const now = Date.parse("2026-10-28T20:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("registry", () => {
  it("registers the new connectors as live", () => {
    for (const id of ["central-banks", "ofac-sanctions", "sanctions-news", "cloud-status", "app-status", "fda-recalls", "cpsc-recalls", "hibp-breaches", "un-press"]) {
      const c = getConnector(id);
      expect(c?.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    }
  });
});

describe("central banks", () => {
  const fedXml = `<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm]]></link><description><![CDATA[Federal Reserve issues FOMC statement]]></description><category>Monetary Policy</category><pubDate><![CDATA[Wed, 28 Oct 2026 18:00:00 GMT]]></pubDate></item>
    <item><title>Federal Reserve Board announces approval of application by Isabella Bank Corporation</title><link>https://www.federalreserve.gov/newsevents/pressreleases/orders20261020a.htm</link><pubDate>Tue, 20 Oct 2026 18:00:00 GMT</pubDate></item>
    <item><title>Old release</title><link>https://www.federalreserve.gov/x.htm</link><pubDate>Tue, 01 Sep 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
  const boeXml = `<rss><channel><item><guid isPermaLink="false">{1}</guid><link>https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/november-2026</link><title>Bank Rate reduced to 3.5% - November 2026 Monetary Policy Summary and Minutes</title><description>The MPC voted to reduce Bank Rate.</description><pubDate>Wed, 28 Oct 2026 12:00:00 +0000</pubDate></item>
    <item><guid>{2}</guid><link>https://www.bankofengland.co.uk/minutes/2026/x</link><title>Minutes of the Money Market Committee meeting – September 2026</title><pubDate>Wed, 28 Oct 2026 10:00:00 +0000</pubDate></item></channel></rss>`;
  const bojXml = `<rss><channel><item><title>Money Stock (Sept.)</title><pubDate>Tue, 27 Oct 2026 08:50:00 +0900</pubDate><link>http://www.boj.or.jp/en/statistics/money/ms/ms2609.pdf</link></item>
    <item><title>Statement on Monetary Policy</title><pubDate>Tue, 27 Oct 2026 12:00:00 +0900</pubDate><link>http://www.boj.or.jp/en/mopo/mpmdeci/state_2026/k261027a.pdf</link></item></channel></rss>`;

  it("labels rate decisions from the bank's own title and skips routine items", () => {
    const r = parseCentralBanks({ feeds: [{ bank: "fed", items: parseFeedXml(fedXml) }, { bank: "boe", items: parseFeedXml(boeXml) }, { bank: "boj", items: parseFeedXml(bojXml) }] }, ctx);
    expect(r.candidates.map((c) => c.title)).toEqual([
      "Rate decision — Federal Reserve issues FOMC statement",
      "Rate decision — Bank of England: Bank Rate reduced to 3.5% - November 2026 Monetary Policy Summary and Minutes",
      "Rate decision — Bank of Japan: Statement on Monetary Policy",
    ]);
    expect(r.skipped).toBe(4);
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", subtype: "rate decision", country: "US", timestamp: "2026-10-28T18:00:00.000Z", geoPrecision: "city" });
    expect(r.candidates[2].timestamp).toBe("2026-10-27T03:00:00.000Z");
    expect(valid(r.candidates)).toBe(true);
  });

  it("classifies other releases", () => {
    const ecb = CENTRAL_BANKS.find((b) => b.id === "ecb")!;
    const boc = CENTRAL_BANKS.find((b) => b.id === "boc")!;
    expect(classifyRelease(ecb, "Monetary policy decisions")).toBe("rate decision");
    expect(classifyRelease(ecb, "Christine Lagarde: IMFC Statement")).toBe("speech");
    expect(classifyRelease(boc, "Bank of Canada maintains the policy rate at 2¼%")).toBe("rate decision");
    expect(classifyRelease(CENTRAL_BANKS[0], "Federal Reserve Board issues enforcement action with Ontario Bancorporation, Inc.")).toBe("enforcement action");
  });
});

describe("OFAC sanctions list service", () => {
  const xml = `<?xml version="1.0"?><sanctionsData><publicationInfo><datePublished>2026-10-21T00:00:00-04:00</datePublished><publicationType>Standard Action</publicationType></publicationInfo><entities>
    <entity id="1" action="remove"><generalInfo><entityType refId="601">Entity</entityType></generalInfo><sanctionsPrograms><sanctionsProgram id="1" refId="2">DPRK3</sanctionsProgram></sanctionsPrograms><names><name id="9"><isPrimary>true</isPrimary><translations><translation><formattedFullName>MOXING CARTOON</formattedFullName></translation></translations></name></names></entity>
    <entity id="2" action="add"><generalInfo><entityType refId="602">Vessel</entityType></generalInfo><sanctionsPrograms><sanctionsProgram id="3" refId="4">IRAN-EO13902</sanctionsProgram></sanctionsPrograms><names><name id="10"><isPrimary>true</isPrimary><translations><translation><formattedFullName>SEA STAR</formattedFullName></translation></translations></name></names><addresses><address><country refId="1">Panama</country></address></addresses></entity>
    <entity id="3" action="add"><generalInfo><entityType refId="600">Individual</entityType></generalInfo><sanctionsPrograms><sanctionsProgram id="5" refId="4">IRAN-EO13902</sanctionsProgram></sanctionsPrograms><names><name id="11"><isPrimary>false</isPrimary><translations><translation><formattedFullName>ALIAS ONE</formattedFullName></translation></translations></name><name id="12"><isPrimary>true</isPrimary><translations><translation><formattedFullName>DOE, John</formattedFullName></translation></translations></name></names></entity>
  </entities></sanctionsData>`;

  it("reads a delta file", () => {
    const d = parseDelta(xml);
    expect(d).toMatchObject({ publicationType: "Standard Action", utcOffset: "-04:00" });
    expect(d.entries.map((e) => [e.action, e.type, e.name])).toEqual([["remove", "Entity", "MOXING CARTOON"], ["add", "Vessel", "SEA STAR"], ["add", "Individual", "DOE, John"]]);
    expect(d.entries[1].countries).toEqual(["Panama"]);
  });

  it("makes one event per publication, in Eastern time", () => {
    const r = parseOfac({ publications: [{ publicationID: 1075, datePublished: "2026-10-21T12:35:16.73097", xml }, { publicationID: 1076, datePublished: "2026-10-22T10:00:00", xml: null }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ title: "OFAC sanctions list update: 2 additions, 1 removal — IRAN-EO13902, DPRK3", timestamp: "2026-10-21T16:35:16.730Z", type: "POLITICS", subtype: "sanctions" });
    expect(r.candidates[0].entities?.map((e) => e.type)).toEqual(["ORGANIZATION", "VEHICLE", "PERSON"]);
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("EU & UK sanctions", () => {
  it("keeps sanctions titles and places them at a named target country", () => {
    const eu = parseFeedXml(`<rss><channel><item><guid>1</guid><link>https://www.consilium.europa.eu/en/press/press-releases/2026/10/26/eu-sanctions-isil/</link><title>EU sanctions against ISIL/Da’esh and Al-Qaeda: Council renews regime until 2027</title><description>The Council renewed…</description><a10:updated>2026-10-26T11:05:00+01:00</a10:updated></item>
      <item><guid>2</guid><link>https://www.consilium.europa.eu/en/press/press-releases/2026/10/27/media-advisory/</link><title>Media advisory - Accreditation for the EU-UK Summit</title><a10:updated>2026-10-27T12:30:00+01:00</a10:updated></item></channel></rss>`);
    const uk = parseFeedXml(`<feed><entry><id>x</id><updated>2026-10-26T10:10:00+00:00</updated><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/uk-sanctions-commanders-sudan"/><title>UK sanctions senior commanders implicated in campaign of rape in Sudan</title><summary>…</summary></entry></feed>`);
    const r = parseSanctionsNews({ feeds: [{ feed: "eu-council", items: eu }, { feed: "uk-gov", items: uk }] }, ctx);
    expect(r.candidates.map((c) => [c.locationName, c.country])).toEqual([["Council of the EU, Brussels", "BE"], ["Sudan", "SD"]]);
    expect(r.skipped).toBe(1);
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("status pages", () => {
  const sp = (o: Record<string, unknown>) => ({ id: "abc", name: "Network Performance Issues in Ashburn, IAD", status: "investigating", impact: "minor", created_at: "2026-10-28T04:39:13Z", resolved_at: null, shortlink: "https://stspg.io/abc", components: [{ name: "Ashburn, VA, United States - (IAD)" }], incident_updates: [{ body: "We are investigating." }], ...o });

  it("reads AWS guids and groups updates per service and region", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Service is operating normally: [RESOLVED] Increased Error Rates]]></title><pubDate>Wed, 28 Oct 2026 06:10:00 PDT</pubDate><guid isPermaLink="false">https://status.aws.amazon.com/#ec2-us-east-1_1793193000</guid><description><![CDATA[Resolved.]]></description></item>
      <item><title><![CDATA[Service disruption: Increased Error Rates]]></title><pubDate>Wed, 28 Oct 2026 05:00:00 PDT</pubDate><guid isPermaLink="false">https://status.aws.amazon.com/#ec2-us-east-1_1793188800</guid><description><![CDATA[Investigating.]]></description></item>
      <item><title><![CDATA[Informational message: Old]]></title><pubDate>Tue, 15 Sep 2026 03:27:10 PDT</pubDate><guid isPermaLink="false">https://status.aws.amazon.com/#s3-me-central-1_1789468030</guid><description>x</description></item></channel></rss>`;
    const items = parseAwsRss(xml);
    expect(items[0].guid).toBe("https://status.aws.amazon.com/#ec2-us-east-1_1793193000");
    const r = parseCloudStatus({ aws: items }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      title: "AWS incident: Increased Error Rates (ec2, us-east-1)",
      timestamp: "2026-10-28T12:00:00.000Z",
      resolvedAt: "2026-10-28T13:10:00.000Z",
      locationName: "N. Virginia (us-east-1)",
      type: "INFRASTRUCTURE",
    });
    expect(r.candidates[0].source.externalId).toBe("aws:ec2-us-east-1_1793188800");
  });

  it("places single-region Google Cloud incidents and keeps open ones", () => {
    const r = parseCloudStatus({
      gcp: [
        { id: "g1", begin: "2026-10-27T06:00:00+00:00", end: "2026-10-27T12:10:00+00:00", external_desc: "Multiple services were experiencing issues in the europe-west2 region.", severity: "medium", service_name: "Multiple Products", uri: "incidents/g1", previously_affected_locations: [{ id: "europe-west2" }] },
        { id: "g2", begin: "2026-10-28T10:00:00+00:00", end: null, external_desc: "Elevated errors", severity: "high", currently_affected_locations: [{ id: "global" }, { id: "us-central1" }] },
        { id: "g3", begin: "2026-10-01T10:00:00+00:00", end: "2026-10-01T11:00:00+00:00", external_desc: "Old" },
      ],
    }, ctx);
    expect(r.candidates.map((c) => [c.source.externalId, c.locationName, c.resolvedAt])).toEqual([
      ["gcp:g1", "London (europe-west2)", "2026-10-27T12:10:00.000Z"],
      ["gcp:g2", "Google, Mountain View, CA", null],
    ]);
    expect(r.candidates[1].metrics).toMatchObject({ impact: "critical" });
    expect(valid(r.candidates)).toBe(true);
  });

  it("places Cloudflare PoP incidents at the airport and resolves finished ones", () => {
    expect(placeFromPop("Network Performance Issues in Ashburn, IAD")?.country).toBe("US");
    expect(placeFromPop("Increased latency for R2 in ENAM")).toBeUndefined();
    const r = parseCloudStatus({
      statuspage: [{ provider: "cloudflare", incidents: [sp({}), sp({ id: "b", name: "Cache purge delays", status: "resolved", resolved_at: "2026-10-28T05:00:00Z" }), sp({ id: "c", impact: "none" }), sp({ id: "d", status: "resolved", created_at: "2026-10-20T00:00:00Z" })] }],
    }, ctx);
    expect(r.candidates.map((c) => [c.source.id, c.geoPrecision, c.resolvedAt])).toEqual([
      ["cloud-status:cloudflare:abc", "region", null],
      ["cloud-status:cloudflare:b", "city", "2026-10-28T05:00:00.000Z"],
    ]);
    expect(r.skipped).toBe(2);
    expect(regionPlace("ap-southeast-2")?.country).toBe("AU");
    expect(valid(r.candidates)).toBe(true);
  });

  it("reads app status pages and Slack incidents", () => {
    const r = parseAppStatus({
      statuspage: [{ provider: "github", incidents: [sp({ name: "Disruption with some Copilot services", status: "resolved", resolved_at: "2026-10-28T15:28:19Z", created_at: "2026-10-28T14:12:53Z" })] }],
      slack: [
        { id: 1582, title: "Slack Real-Time Connection Disruption", type: "incident", status: "resolved", url: "https://slack-status.com/2026-10/58a", date_created: "2026-10-28T11:50:50-07:00", date_updated: "2026-10-28T12:30:00-07:00", services: ["Messaging"] },
        { id: 1, title: "Scheduled maintenance", type: "notice", status: "active", date_created: "2026-10-28T11:50:50-07:00" },
      ],
    }, ctx);
    expect(r.candidates.map((c) => c.title)).toEqual(["GitHub incident: Disruption with some Copilot services", "Slack incident: Slack Real-Time Connection Disruption"]);
    expect(r.candidates[1]).toMatchObject({ type: "TECHNOLOGY", resolvedAt: "2026-10-28T19:30:00.000Z" });
    expect(r.candidates[0].source.assertion).toBe("OFFICIAL_PRELIMINARY");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("recalls", () => {
  it("groups FDA Class I enforcement records by recall event", () => {
    const base = { event_id: "100041", classification: "Class I", recalling_firm: "Made Fresh Salads Inc", city: "Bay Shore", state: "NY", country: "United States", reason_for_recall: "Potential Listeria monocytogenes contamination.", report_date: "20261021", product_description: "Made Fresh brand Black Bean and Corn Salad, 8 oz", status: "Ongoing" };
    const r = parseFdaRecalls({ results: [
      { ...base, recall_number: "F-1", category: "food" },
      { ...base, recall_number: "F-2", category: "food" },
      { ...base, event_id: "2", recall_number: "F-3", classification: "Class II", category: "food" },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({ title: "FDA Class I food recall: Made Fresh Salads Inc — Made Fresh brand Black Bean and Corn Salad", type: "HEALTH", timestamp: "2026-10-21T12:00:00.000Z", country: null });
    expect(r.candidates[0].locationName).toContain("New York");
    expect(r.candidates[0].metrics).toMatchObject({ products: 2 });
    expect(fdaDate("20261021")).toBe("2026-10-21");
    expect(productName("Deano's Pasta; 1 lb bags")).toBe("Deano's Pasta");
    expect(valid(r.candidates)).toBe(true);
  });

  it("reads CPSC recalls", () => {
    const r = parseCpsc({ recalls: [
      { RecallID: 11031, RecallNumber: "27042", RecallDate: "2026-10-22T00:00:00", Title: "BAMAMON Recalls LED Projecting Finger Light Toys Due to Risk of Serious Injury or Death from Battery Ingestion", URL: "https://www.cpsc.gov/Recalls/2027/BAMAMON", Products: [{ NumberOfUnits: "About 6,533" }], Hazards: [{ Name: "None reported." }], Injuries: [{ Name: "None reported." }], ManufacturerCountries: [{ Country: "China" }] },
      { RecallID: 1, RecallNumber: "1", RecallDate: "2026-08-01T00:00:00", Title: "Old recall" },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: "OTHER", subtype: "product recall", country: "US" });
    expect(r.candidates[0].summary).toContain("Units: About 6,533");
    expect(r.candidates[0].summary).not.toContain("Hazard: None");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("cyber", () => {
  it("files ransomware leak-site claims as unverified claims at the victim's country", () => {
    const r = parseRansomware({ victims: [
      { victim: "Hauhinco", group: "payload", country: "DE", activity: "Manufacturing", discovered: "2026-10-28T14:49:50.25+00:00", url: "https://www.ransomware.live/id/abc" },
      { victim: "Hauhinco", group: "payload", country: "DE", discovered: "2026-10-28T14:50:00+00:00" },
      { victim: "wagyu.xyz", group: "Whitearmor", country: "", discovered: "2026-10-27T15:06:27+00:00" },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({ title: "Ransomware claim: payload lists Hauhinco (Germany)", type: "TECHNOLOGY", subtype: "cyber attack", country: "DE", geoPrecision: "country" });
    expect(r.candidates[0].source).toMatchObject({ sourceType: "COMMUNITY_DATABASE", assertion: "MEDIA_REPORT" });
    expect(valid(r.candidates)).toBe(true);
  });

  it("keeps newly added HIBP breaches, placed by country-code domain", () => {
    const r = parseHibp({ breaches: [
      { Name: "AfD", Title: "AfD", Domain: "afd.de", BreachDate: "2026-09-09", AddedDate: "2026-10-27T07:01:06Z", PwnCount: 345439, DataClasses: ["Email addresses"], IsVerified: true },
      { Name: "Crunchbase", Title: "Crunchbase", Domain: "crunchbase.com", AddedDate: "2026-10-20T06:01:26Z", PwnCount: 559908, IsVerified: true },
      { Name: "Spam", Title: "Spam list", AddedDate: "2026-10-27T07:01:06Z", IsSpamList: true },
      { Name: "Old", Title: "Old", AddedDate: "2026-01-01T00:00:00Z" },
    ] }, ctx);
    expect(r.candidates.map((c) => [c.title, c.country, c.geoPrecision])).toEqual([
      ["Data breach added to Have I Been Pwned: AfD (345,439 accounts)", "DE", "country"],
      ["Data breach added to Have I Been Pwned: Crunchbase (559,908 accounts)", null, "approximate"],
    ]);
    expect(countryOfDomain("example.io")).toBeNull();
    expect(countryOfDomain("bbc.co.uk")?.code).toBe("GB");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("UN press", () => {
  it("skips routine notices and prefers a non-US place", () => {
    const items = parseFeedXml(`<rss><channel>
      <item><title>General Assembly Adopts Resolution to Lift United States Embargo of Cuba</title><link>https://press.un.org/en/2026/ga12700.doc.htm</link><pubDate>Wed, 28 Oct 2026 14:15:29 -0400</pubDate></item>
      <item><title>Daily Press Briefing by the Office of the Spokesperson for the Secretary-General</title><link>https://press.un.org/en/2026/db261028.doc.htm</link><pubDate>Wed, 28 Oct 2026 14:00:00 -0400</pubDate></item>
      <item><title>Security Council, 10254th Meeting (PM) Women, Peace and Security</title><link>https://press.un.org/en/2026/sc16200.doc.htm</link><pubDate>Tue, 27 Oct 2026 16:20:15 -0400</pubDate></item></channel></rss>`);
    const r = parseUnPress({ items }, ctx);
    expect(r.candidates.map((c) => [c.country, c.subtype])).toEqual([["CU", "UN press release"], ["US", "UN Security Council"]]);
    expect(unBody("Secretary-General Appoints X", "https://press.un.org/en/2026/sga2300.doc.htm")).toBe("Secretary-General");
    expect(valid(r.candidates)).toBe(true);
  });
});
