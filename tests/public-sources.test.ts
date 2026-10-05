import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { parseFederalRegister } from "@/data-sources/federal-register";
import { parseTravelAdvisories, splitAdvisoryTitle } from "@/data-sources/travel-advisories";
import { parseCdcTravel, splitCdcTitle } from "@/data-sources/cdc-travel";
import { parseAdsbEmergency } from "@/data-sources/adsb-emergency";
import { buildCot } from "@/lib/finance/cot";

const now = Date.parse("2026-10-05T20:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("Federal Register", () => {
  it("places documents about a foreign country there, others at the White House", () => {
    const r = parseFederalRegister(
      { results: [
        { title: "Continuation of the National Emergency With Respect to Syria", type: "Presidential Document", document_number: "2026-1", html_url: "https://www.federalregister.gov/d/2026-1", publication_date: "2026-10-02", abstract: null },
        { title: "Streamlining Access to Government Services", type: "Presidential Document", document_number: "2026-2", html_url: "https://www.federalregister.gov/d/2026-2", publication_date: "2026-10-02", abstract: null },
      ] },
      ctx,
    );
    expect(r.candidates.map((c) => c.country)).toEqual(["SY", "US"]);
    expect(r.candidates[1].geoPrecision).toBe("exact");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("travel advisories", () => {
  it("splits titles and keeps recent level 2–4 advisories", () => {
    expect(splitAdvisoryTitle("Saudi Arabia - Level 3: Reconsider Travel")).toEqual({ place: "Saudi Arabia", level: 3 });
    const item = (title: string, days: number) => ({ title, link: "https://travel.state.gov/x", description: "<p>Reconsider travel due to <b>crime</b>. Read the entire Travel Advisory.</p>", published: new Date(now - days * 86_400_000).toUTCString() });
    const r = parseTravelAdvisories({ items: [item("Saudi Arabia - Level 3: Reconsider Travel", 5), item("Italy - Level 1: Exercise Normal Precautions", 5), item("Mali - Level 4: Do Not Travel", 90)] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ country: "SA", metrics: { advisory_level: 3 } });
    expect(r.candidates[0].description).toBe("Reconsider travel due to crime.");
    expect(r.candidates[0].supersedes).toContain("travel-advisories:SA:4");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("CDC travel notices", () => {
  it("parses country notices and skips global ones", () => {
    expect(splitCdcTitle("Level 2 - Yellow Fever in Colombia")).toEqual({ level: 2, topic: "Yellow Fever", place: "Colombia" });
    const pub = new Date(now - 10 * 86_400_000).toUTCString();
    const r = parseCdcTravel({ items: [
      { title: "Level 2 - Yellow Fever in Colombia", link: "https://wwwnc.cdc.gov/travel/notices/level2/yellow-fever-colombia", description: "Cases reported.", published: pub },
      { title: "Level 1 - Global Dengue", link: "https://wwwnc.cdc.gov/travel/notices/level1/dengue-global", description: "", published: pub },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: "HEALTH", country: "CO", title: "Yellow Fever in Colombia — CDC travel notice level 2" });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("ADS-B emergency squawks", () => {
  it("keeps aircraft with a recent position and an emergency code", () => {
    const r = parseAdsbEmergency({ now, aircraft: [
      { hex: "a1b2c3", flight: "UAL123 ", r: "N123UA", t: "B738", squawk: "7700", lat: 40.1, lon: -74.2, alt_baro: 12000, seen_pos: 3 },
      { hex: "a1b2c4", squawk: "1200", lat: 40, lon: -74 },
      { hex: "a1b2c5", squawk: "7600", lat: 40, lon: -74, seen_pos: 900 },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].title).toBe("Aircraft squawking 7700 (general emergency) — UAL123 (B738)");
    expect(r.candidates[0].summary).toContain("not a confirmed incident");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("CFTC positioning", () => {
  it("computes net speculative positions, weekly change and range percentile", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      cftc_contract_market_code: "088691",
      report_date_as_yyyy_mm_dd: new Date(Date.UTC(2026, 0, 6) + i * 7 * 86_400_000).toISOString(),
      open_interest_all: "500000",
      noncomm_positions_long_all: String(200000 + i * 1000),
      noncomm_positions_short_all: "100000",
    }));
    const [gold] = buildCot(rows);
    expect(gold).toMatchObject({ name: "Gold", netSpec: 129000, netChange: 1000, netPctOi: 25.8, percentile3y: 100 });
    expect(gold.history).toHaveLength(30);
  });
});

import { finraSymbol, parseShortFile } from "@/lib/finance/short-volume";

describe("FINRA short volume", () => {
  it("parses the daily file and maps symbols", () => {
    const f = parseShortFile("Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261002|AAPL|267855.7|428|711868.9|B,Q,N\n20261002|BRK.B|10|0|0|N\n");
    expect(f.get("AAPL")).toEqual({ s: 267855.7, t: 711868.9 });
    expect(f.has("BRK.B")).toBe(false); // zero total volume
    expect(finraSymbol("BRK-B")).toBe("BRK.B");
    expect(finraSymbol("7203.T")).toBeNull();
    expect(finraSymbol("^GSPC")).toBeNull();
    expect(finraSymbol("BTC-USD")).toBeNull();
  });
});
