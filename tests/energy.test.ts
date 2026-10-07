import { describe, expect, it } from "vitest";
import {
  buildMix,
  madridDay,
  nemToUtc,
  parseEco2mix,
  parseElexonDemand,
  parseElexonMid,
  parseGbGeneration,
  parseGbIntensity,
  parseNemSummary,
  parseReeCo2,
  parseReeGeneration,
  parseSmard,
  reeLatest,
  renewableShareOf,
  smardLatest,
  toUtcIso,
} from "@/lib/energy";

describe("energy helpers", () => {
  it("normalises timestamps to UTC ISO", () => {
    expect(toUtcIso("2026-10-07T05:00Z")).toBe("2026-10-07T05:00:00.000Z");
    expect(toUtcIso("2026-10-07T07:40:00.000+02:00")).toBe("2026-10-07T05:40:00.000Z");
    expect(toUtcIso("nope")).toBeNull();
    expect(nemToUtc("2026-10-07T15:50:00")).toBe("2026-10-07T05:50:00.000Z");
  });
  it("builds a mix: drops negatives, merges fuels, renormalises to 100", () => {
    const mix = buildMix([["coal", 30], ["coal", 10], ["wind", 60], ["gas", -5], ["solar", null]], "t", "b")!;
    expect(mix.fuels).toEqual([
      { fuel: "wind", label: "Wind", share: 60 },
      { fuel: "coal", label: "Coal", share: 40 },
    ]);
    expect(renewableShareOf(mix)?.value).toBe(60);
    expect(buildMix([["gas", 0]], "t", "b")).toBeNull();
  });
  it("gives the Spanish calendar day", () => {
    expect(madridDay(Date.parse("2026-10-06T22:30:00Z"))).toBe("2026-10-07");
    expect(madridDay(Date.parse("2026-10-06T22:30:00Z"), -1)).toBe("2026-10-06");
  });
});

describe("Great Britain", () => {
  it("parses carbon intensity, preferring actual over forecast", () => {
    expect(parseGbIntensity({ data: [{ from: "2026-10-07T05:00Z", intensity: { forecast: 189, actual: 220, index: "high" } }] })).toEqual({
      value: 220, unit: "gCO₂/kWh", asOf: "2026-10-07T05:00:00.000Z", note: "actual · high",
    });
    expect(parseGbIntensity({ data: [{ from: "2026-10-07T05:00Z", intensity: { forecast: 189, actual: null } }] })?.note).toBe("forecast");
    expect(parseGbIntensity({ data: [] })).toBeNull();
  });
  it("parses the generation mix", () => {
    const mix = parseGbGeneration({
      data: {
        from: "2026-10-07T05:00Z",
        generationmix: [
          { fuel: "biomass", perc: 10.5 }, { fuel: "coal", perc: 0 }, { fuel: "imports", perc: 3 }, { fuel: "gas", perc: 49.1 }, { fuel: "nuclear", perc: 13.1 },
          { fuel: "other", perc: 4.9 }, { fuel: "hydro", perc: 4.6 }, { fuel: "solar", perc: 0 }, { fuel: "wind", perc: 14.8 },
        ],
      },
    })!;
    expect(mix.fuels.map((f) => f.fuel)).toEqual(["wind", "hydro", "bio", "nuclear", "gas", "imports", "other"]);
    expect(mix.fuels.find((f) => f.fuel === "gas")?.share).toBe(49.1);
    expect(renewableShareOf(mix)?.value).toBe(29.9);
  });
  it("parses Elexon demand and Market Index price (skipping zero-volume periods)", () => {
    expect(parseElexonDemand([{ startTime: "2026-10-07T05:40:00Z", demand: 30053 }, { startTime: "2026-10-07T05:45:00Z", demand: 30426 }])).toMatchObject({ value: 30426, unit: "MW", asOf: "2026-10-07T05:45:00.000Z" });
    expect(parseElexonDemand([])).toBeNull();
    const mid = parseElexonMid({
      data: [
        { startTime: "2026-10-07T06:00:00Z", price: 0, volume: 0 },
        { startTime: "2026-10-07T05:30:00Z", price: 205.92, volume: 2932 },
        { startTime: "2026-10-07T05:00:00Z", price: 195.28, volume: 3013.95 },
      ],
    });
    expect(mid).toMatchObject({ value: 205.92, unit: "£/MWh", asOf: "2026-10-07T05:30:00.000Z" });
  });
});

describe("Spain (REE)", () => {
  const gen = {
    included: [
      { type: "Hydro", attributes: { title: "Hydro", type: "Renovable", values: [{ value: 74000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Nuclear", attributes: { title: "Nuclear", type: "No-Renovable", values: [{ value: 166000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Coal", attributes: { title: "Coal", type: "No-Renovable", values: [{ value: -80, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Combined cycle", attributes: { title: "Combined cycle", type: "No-Renovable", values: [{ value: 160000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Wind", attributes: { title: "Wind", type: "Renovable", values: [{ value: 100000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Solar photovoltaic", attributes: { title: "Solar photovoltaic", type: "Renovable", values: [{ value: 90000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Cogeneration", attributes: { title: "Cogeneration", type: "No-Renovable", values: [{ value: 10000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
      { type: "Total generation", attributes: { title: "Total generation", type: "total", values: [{ value: 600000, datetime: "2026-10-06T00:00:00.000+02:00" }] } },
    ],
  };
  it("parses the previous day's mix, ignoring totals and negative output", () => {
    const mix = parseReeGeneration(gen, "2026-10-06")!;
    expect(mix.asOf).toBe("2026-10-06");
    expect(mix.unit).toBe("MWh");
    expect(mix.fuels.map((f) => [f.fuel, f.share])).toEqual([["wind", 16.7], ["solar", 15], ["hydro", 12.3], ["nuclear", 27.7], ["gas", 26.7], ["otherFossil", 1.7]]);
    expect(parseReeGeneration(gen, "2026-10-05")).toBeNull();
  });
  it("parses CO₂ intensity (t/MWh → g/kWh)", () => {
    const co2 = { included: [{ type: "tCO2 eq./MWh", attributes: { title: "tCO2 eq./MWh", values: [{ value: 0.16273, datetime: "2026-10-06T00:00:00.000+02:00" }] } }] };
    expect(parseReeCo2(co2, "2026-10-06")).toMatchObject({ value: 163, unit: "gCO₂/kWh", asOf: "2026-10-06" });
  });
  it("takes the latest real-time value at or before now (ignoring scheduled future periods)", () => {
    const px = {
      included: [
        { type: "Spot market price", attributes: { title: "Spot market price", values: [
          { value: 240, datetime: "2026-10-07T07:30:00.000+02:00" },
          { value: 242.36, datetime: "2026-10-07T07:45:00.000+02:00" },
          { value: 300, datetime: "2026-10-07T20:00:00.000+02:00" },
        ] } },
      ],
    };
    expect(reeLatest(px, "Spot market price", Date.parse("2026-10-07T05:50:00Z"))).toEqual({ value: 242.36, asOf: "2026-10-07T05:45:00.000Z" });
    expect(reeLatest(px, "Real", Date.parse("2026-10-07T05:50:00Z"))).toBeNull();
  });
});

describe("France (eco2mix)", () => {
  it("parses demand, mix (pumped storage split from hydro) and CO₂ rate", () => {
    const r = parseEco2mix({
      date_heure: "2026-10-07T05:30:00+00:00", consommation: 43789, nucleaire: 37490, eolien: 3115, solaire: 168, hydraulique: 6484, hydraulique_step_turbinage: 2074,
      bioenergies: 992, gaz: 4288, charbon: 0, fioul: 37, pompage: -46, destockage_batterie: 346, ech_physiques: -9065, taux_co2: 45,
    })!;
    expect(r.demand).toMatchObject({ value: 43789, unit: "MW", asOf: "2026-10-07T05:30:00.000Z" });
    expect(r.carbon?.value).toBe(45);
    const by = Object.fromEntries(r.mix!.fuels.map((f) => [f.fuel, f.value]));
    expect(by).toEqual({ wind: 3115, solar: 168, hydro: 4410, bio: 992, nuclear: 37490, gas: 4288, oil: 37, storage: 2420 });
    expect(renewableShareOf(r.mix)?.value).toBe(16.4);
    expect(parseEco2mix(undefined)).toBeNull();
    expect(parseEco2mix({ date_heure: "2026-10-07T05:30:00+00:00", consommation: null })).toBeNull();
  });
});

describe("Germany (SMARD)", () => {
  const t0 = Date.parse("2026-10-07T03:00:00Z"), t1 = Date.parse("2026-10-07T04:00:00Z"), t2 = Date.parse("2026-10-07T05:00:00Z");
  it("picks the latest published point at or before now", () => {
    expect(smardLatest([[t0, 1], [t1, 2], [t2, null]], t2 + 1)).toEqual([t1, 2]);
    expect(smardLatest([[t0, null]], t2)).toBeNull();
  });
  it("aligns the mix to the latest load hour and reads the current price", () => {
    const r = parseSmard(
      [[t0, 54000], [t1, 55189.21], [t2, null]],
      [["wind", [[t1, 3000]]], ["wind", [[t1, 1000]]], ["coal", [[t1, 5000], [t2, 9999]]], ["solar", [[t1, 0]]], ["nuclear", [[t1, null]]]],
      [[t1, 250], [t2, 271.97], [t2 + 3_600_000, 300]],
      t2 + 60_000,
    );
    expect(r.demand).toMatchObject({ value: 55189, unit: "MW", asOf: "2026-10-07T04:00:00.000Z" });
    expect(r.mix?.fuels.map((f) => [f.fuel, f.value])).toEqual([["wind", 4000], ["coal", 5000]]);
    expect(r.price).toMatchObject({ value: 271.97, unit: "€/MWh", asOf: "2026-10-07T05:00:00.000Z" });
    expect(parseSmard([], [], null).demand).toBeNull();
  });
});

describe("Australia (AEMO NEM)", () => {
  it("parses regions, total demand and demand-weighted price, converting AEST to UTC", () => {
    const r = parseNemSummary({
      ELEC_NEM_SUMMARY: [
        { SETTLEMENTDATE: "2026-10-07T15:50:00", REGIONID: "NSW1", PRICE: 100, TOTALDEMAND: 6000 },
        { SETTLEMENTDATE: "2026-10-07T15:50:00", REGIONID: "SA1", PRICE: -16, TOTALDEMAND: 581.26 },
        { SETTLEMENTDATE: "2026-10-07T15:50:00", REGIONID: "QLD1", PRICE: 86, TOTALDEMAND: 6680.5 },
      ],
    });
    expect(r.regions.map((x) => x.id)).toEqual(["NSW1", "QLD1", "SA1"]);
    expect(r.regions[2]).toEqual({ id: "SA1", name: "South Australia", demandMw: 581, price: -16 });
    expect(r.demand).toMatchObject({ value: 13262, unit: "MW", asOf: "2026-10-07T05:50:00.000Z" });
    expect(r.price?.value).toBeCloseTo((100 * 6000 - 16 * 581 + 86 * 6681) / 13262, 2);
    expect(r.price?.unit).toBe("A$/MWh");
    expect(parseNemSummary({}).demand).toBeNull();
  });
});
