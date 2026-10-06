import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { cleanWikitext, parseWikipediaEvents, placeForSentence } from "@/data-sources/wikipedia-events";
import { aqiCategory, parseAirQuality } from "@/data-sources/air-quality";
import { fdicDate, parseFdicFailures } from "@/data-sources/fdic-failures";
import { parseAuctions } from "@/lib/finance/auctions";
import { ensoLabel, kpLabel, parseCo2Daily, parseOni, parseSeaIce, yearAgo } from "@/lib/planet";
import { seaInText } from "@/lib/geo/headline-places";

const now = Date.parse("2026-10-05T20:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("Wikipedia Current Events", () => {
  it("cleans wikitext, keeping link targets for placement and citations", () => {
    const c = cleanWikitext("**Two people are killed in [[Vienna, Georgia|Vienna]], [[Georgia (U.S. state)|Georgia]]. [https://apnews.com/x (''AP'')]");
    expect(c.text).toBe("Two people are killed in Vienna, Georgia.");
    expect(c.locText).toContain("Vienna Georgia");
    expect(c.cites).toEqual([{ url: "https://apnews.com/x", outlet: "AP" }]);
  });
  it("places on a cued place or the first one mentioned, and at sea when cued", () => {
    expect(placeForSentence("Brazilians head to the polls President of Brazil ... his opponent is a Rio de Janeiro senator")?.country.code).toBe("BR");
    expect(placeForSentence("Brazilians head to the polls President of Brazil ... his opponent is a Rio de Janeiro senator")?.city).toBeNull();
    expect(seaInText("killed in an airstrike against a boat in the Caribbean Sea")?.cued).toBe(true);
  });
  it("parses sections and items, using topic lines as location context", () => {
    const wikitext = [
      "'''Armed conflicts and attacks'''",
      "*[[War in Sudan]]",
      "**An airstrike hits a market, killing twelve people. [https://www.aljazeera.com/a (Al Jazeera)]",
      "*Four people are killed in an airstrike on a boat in the [[Caribbean Sea]]. [https://apnews.com/b (AP)]",
      "'''Politics and elections'''",
      "*A topic heading with no citation",
    ].join("\n");
    const r = parseWikipediaEvents({ days: [{ date: "2026-10-04", wikitext }] }, ctx);
    expect(r.candidates.map((c) => [c.type, c.country, c.locationName])).toEqual([
      ["CONFLICT", "SD", "Sudan"],
      ["CONFLICT", null, "Caribbean Sea"],
    ]);
    expect(r.candidates[0].timestamp).toBe("2026-10-04T12:00:00.000Z");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("air quality", () => {
  it("maps only unhealthy or worse and labels it modelled", () => {
    expect(aqiCategory(186)).toBe("Unhealthy");
    expect(aqiCategory(320)).toBe("Hazardous");
    const city = { name: "Delhi", country: "IN", countryName: "India", admin1: null, lat: 28.6, lon: 77.2, population: 1e7, capital: true };
    const reading = (us_aqi: number) => ({ time: "2026-10-06T05:00", us_aqi, pm2_5: 93.1, pm10: 244, ozone: 210, nitrogen_dioxide: 20.5 });
    const r = parseAirQuality({ readings: [{ city, current: reading(186) }, { city: { ...city, name: "Pune" }, current: reading(90) }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: "HEALTH", timestamp: "2026-10-06T05:00:00.000Z", metrics: { us_aqi: 186, modelled: true } });
    expect(r.candidates[0].summary).toContain("modelled estimate");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("FDIC failures", () => {
  it("parses dates and places the bank at its city", () => {
    expect(fdicDate("7/17/2026")).toBe("2026-07-17");
    const r = parseFdicFailures({ failures: [{ NAME: "THE FARMERS STATE BANK", CITYST: "LENEXA, KS", FAILDATE: "7/17/2026", QBFASSET: 72947, QBFDEP: 68773, COST: 5671, FIN: "10553" }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: "BUSINESS", country: "US", title: "Bank failure: The Farmers State Bank (Lenexa, KS)" });
    expect(r.candidates[0].summary).toContain("$72.9 million in assets");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Treasury auctions", () => {
  it("uses high yield or the bill rate and computes bidder shares", () => {
    const [a] = parseAuctions([{ auction_date: "2026-09-24", security_type: "Note", security_term: "7-Year", high_yield: "5.0850", high_investment_rate: "null", bid_to_cover_ratio: "2.42", indirect_bidder_accepted: "25000000000", primary_dealer_accepted: "5000000000", total_accepted: "50000000000" }]);
    expect(a).toMatchObject({ rate: 5.085, bidToCover: 2.42, indirectPct: 50, dealerPct: 10 });
  });
});

describe("planet indicators", () => {
  it("parses NOAA/NSIDC/CPC formats", () => {
    expect(parseCo2Daily("# comment\n2026,10,4,2026.7562,425.89\n")).toEqual([{ date: "2026-10-04", value: 425.89 }]);
    expect(parseSeaIce("Year, Month, Day, Extent\nYYYY, MM, DD, x\n2026,    10,  04,      5.800,      0.000, x\n")).toEqual([{ date: "2026-10-04", value: 5.8 }]);
    expect(parseOni(" SEAS  YR   TOTAL   ANOM\n  JAS 2026  29.12   2.16\n")).toEqual([{ season: "JAS", year: 2026, anom: 2.16 }]);
  });
  it("labels ENSO and Kp and finds the year-earlier value", () => {
    expect(ensoLabel(2.16)).toBe("Strong El Niño");
    expect(ensoLabel(-0.3)).toBe("Neutral");
    expect(kpLabel(5.3)).toBe("G1 minor storm");
    expect(yearAgo([{ date: "2025-10-03", value: 1 }, { date: "2025-10-04", value: 2 }], "2026-10-04")?.value).toBe(2);
    expect(yearAgo([{ date: "2025-10-01", value: 1 }], "2026-10-04")?.value).toBe(1);
    expect(yearAgo([{ date: "2025-09-01", value: 1 }], "2026-10-04")).toBeNull();
  });
});
