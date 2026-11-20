import { describe, expect, it } from "vitest";
import { countryActivity, dedupeByCode, rankCountries, type CountryListItem } from "@/lib/countries-rank";
import { COUNTRIES } from "@/lib/geo/gazetteer";
import { GET } from "@/app/api/countries/route";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const c = (code: string, name: string, subregion = "X"): CountryListItem => ({ code, name, continent: "C", subregion, population: 1 });
const ev = (country: string | null, importanceScore: number, hoursAgo = 1) => ({ country, importanceScore, timestamp: ago(hoursAgo) });

describe("Countries page ranking", () => {
  const list = [c("RO", "Romania"), c("DE", "Germany"), c("SA", "Saudi Arabia"), c("US", "United States"), c("FR", "France")];
  const events = [
    // Romania: few events but one very important one — must not outrank busier countries.
    ...Array.from({ length: 5 }, (_, i) => ev("RO", i === 0 ? 95 : 20)),
    ...Array.from({ length: 36 }, () => ev("DE", 60)),
    ...Array.from({ length: 34 }, () => ev("SA", 80)),
    ...Array.from({ length: 654 }, () => ev("US", 50)),
    ev("FR", 99, 30), // older than 24 h: not counted
    ev(null, 99),
  ];

  it("sorts by event count in the last 24 h, descending", () => {
    const rows = rankCountries(list, countryActivity(events, NOW));
    expect(rows.map((r) => [r.code, r.n])).toEqual([["US", 654], ["DE", 36], ["SA", 34], ["RO", 5], ["FR", 0]]);
    expect(rows.find((r) => r.code === "RO")?.top).toBe(95);
  });

  it("breaks count ties by top importance, then name", () => {
    const rows = rankCountries([c("BB", "Bravo"), c("AA", "Alpha"), c("CC", "Charlie")], countryActivity([ev("BB", 40), ev("AA", 40), ev("CC", 90)], NOW));
    expect(rows.map((r) => r.code)).toEqual(["CC", "AA", "BB"]);
  });

  it("sorts search results alphabetically", () => {
    const rows = rankCountries([...list, c("GE", "Georgia", "Western Asia")], countryActivity(events, NOW), "ge");
    expect(rows.map((r) => r.name)).toEqual(["Georgia", "Germany"]);
  });
});

describe("territories sharing a sovereign's code", () => {
  it("merges them into the first (sovereign) entry", () => {
    const rows = rankCountries([c("AU", "Australia"), c("AU", "Indian Ocean Ter."), c("AU", "Ashmore and Cartier Is."), c("NZ", "New Zealand")], countryActivity(Array.from({ length: 168 }, () => ev("AU", 30)), NOW));
    expect(rows.map((r) => [r.name, r.n])).toEqual([["Australia", 168], ["New Zealand", 0]]);
  });

  it("the gazetteer has duplicate codes, and dedupe leaves exactly one per code", () => {
    const au = COUNTRIES.filter((x) => x.code === "AU").map((x) => x.name);
    expect(au.length).toBeGreaterThan(1);
    const deduped = dedupeByCode(COUNTRIES);
    expect(new Set(deduped.map((x) => x.code)).size).toBe(deduped.length);
    expect(deduped.find((x) => x.code === "AU")?.name).toBe("Australia");
  });

  it("GET /api/countries lists each code once and no AU territories", async () => {
    const res = await GET();
    const { countries } = (await res.json()) as { countries: CountryListItem[] };
    expect(new Set(countries.map((x) => x.code)).size).toBe(countries.length);
    const names = countries.map((x) => x.name);
    expect(names).toContain("Australia");
    expect(names).not.toContain("Indian Ocean Ter.");
    expect(names).not.toContain("Ashmore and Cartier Is.");
  });
});
