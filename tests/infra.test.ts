import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  cableFeatures,
  clusterPoints,
  csvRecords,
  isTelecomCable,
  landingPointFeatures,
  lngFeatures,
  osmPointFeatures,
  parseCsv,
  pipelineFeatures,
  pipelineSubstance,
  portFeatures,
  powerPlantFeatures,
  simplifyLine,
  baseProps,
  dataCentreProps,
  type OsmElement,
} from "@/lib/infra/parsers";
import { CHOKEPOINTS, chokepointFeatures, chokepointStatus, circleRing, disruptionLevel, disruptionScore } from "@/lib/infra/chokepoints";
import { INFRA_LAYER_IDS, INFRA_LAYERS, INFRA_DATASETS, infraUrl } from "@/lib/infra/catalog";
import { haversineKm } from "@/lib/geo/math";

describe("CSV", () => {
  it("handles quotes, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n3,\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["3", ""]]);
    expect(csvRecords("k,v\n1,2")).toEqual([{ k: "1", v: "2" }]);
  });
});

describe("geometry helpers", () => {
  it("simplifies an open line and keeps endpoints", () => {
    const line: [number, number][] = [[0, 0], [1, 0.0001], [2, 0], [3, 1], [4, 0]];
    const s = simplifyLine(line, 0.01);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([4, 0]);
    expect(s).not.toContainEqual([1, 0]);
    expect(s).toContainEqual([3, 1]);
  });
  it("clusters nearby points", () => {
    const c = clusterPoints([{ lon: 0, lat: 0 }, { lon: 0.01, lat: 0 }, { lon: 1, lat: 1 }], 5);
    expect(c.map((g) => g.length).sort()).toEqual([1, 2]);
  });
});

describe("WRI power plants", () => {
  const csv = [
    "country,country_long,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,commissioning_year,owner",
    "FRA,France,Gravelines,X1,5460,51.015,2.136,Nuclear,1980.0,EDF",
    "FRA,France,Tiny Solar,X2,5,45,1,Solar,,",
    "FRA,France,Tiny Reactor,X3,20,45,2,Nuclear,,",
    "FRA,France,Big Gas,X4,400,46,3,Gas,2001.5,",
    "FRA,France,Broken,X5,400,,3,Gas,,",
  ].join("\n");
  it("keeps plants ≥ min MW plus every nuclear plant, big ones last", () => {
    const f = powerPlantFeatures(csv, 30);
    expect(f.map((x) => x.properties.n)).toEqual(["Tiny Reactor", "Big Gas", "Gravelines"]);
    expect(f[2].properties).toMatchObject({ f: "Nuclear", mw: 5460, c: "France", y: 1980 });
    expect(f[2].geometry.coordinates).toEqual([2.136, 51.015]);
    expect(f[1].properties.y).toBe(2002);
  });
});

describe("World Port Index", () => {
  const csv = [
    "﻿OID_,Main Port Name,UN/LOCODE,Country Code,Harbor Size,Facilities - Oil Terminal,Facilities - LNG Terminal,Latitude,Longitude",
    "1,Rotterdam,NL RTM,Netherlands,Large,Yes,Yes,51.9,4.1",
    "2,Smallville,,Nowhere,Very Small,Unknown,Unknown,10,10",
    "3,Nowhere,,X, ,No,No,abc,1",
  ].join("\n");
  it("parses ports with size and terminal flags", () => {
    const p = portFeatures(csv);
    expect(p).toHaveLength(2);
    expect(p[1].properties).toEqual({ n: "Rotterdam", c: "Netherlands", s: "L", loc: "NL RTM", lng: true, oil: true });
    expect(p[0].properties.s).toBe("V");
  });
  it("adds WPI LNG ports not already covered by an OSM LNG site", () => {
    const ports = portFeatures(csv);
    const osm: OsmElement[] = [{ type: "way", id: 1, center: { lat: 51.95, lon: 4.05 }, tags: { industrial: "lng_terminal", name: "Gate terminal" } }];
    expect(lngFeatures(osm, ports).map((f) => f.properties.n)).toEqual(["Gate terminal"]);
    expect(lngFeatures([], ports).map((f) => f.properties)).toEqual([{ n: "Rotterdam (port)", src: "wpi", c: "Netherlands" }]);
  });
});

describe("OSM extracts", () => {
  const cableWay = (id: number, tags: Record<string, string>, pts: [number, number][]): OsmElement => ({
    type: "way",
    id,
    tags,
    geometry: pts.map(([lon, lat]) => ({ lon, lat })),
  });

  it("recognises underwater telecom cables but not power cables", () => {
    expect(isTelecomCable({ communication: "line", location: "underwater" })).toBe(true);
    expect(isTelecomCable({ "seamark:type": "cable_submarine", "seamark:cable_submarine:category": "fibre_optic" })).toBe(true);
    expect(isTelecomCable({ "seamark:type": "cable_submarine", "seamark:cable_submarine:category": "power", power: "cable" })).toBe(false);
    expect(isTelecomCable({ communication: "line" })).toBe(false);
  });

  it("builds cables and derives landing points at coastal ends", () => {
    const els = [
      cableWay(1, { communication: "line", location: "underwater", name: "TAT-X" }, [[-5, 50], [-30, 48], [-70, 40.5]]),
      cableWay(1, { communication: "line", location: "underwater", name: "TAT-X" }, [[-5, 50], [-70, 40.5]]), // duplicate id
      cableWay(2, { communication: "line", location: "underwater" }, [[0, 0], [0.001, 0]]), // < 1 km
    ];
    const cables = cableFeatures(els);
    expect(cables).toHaveLength(1);
    expect(cables[0].properties).toMatchObject({ n: "TAT-X", osm: "way/1" });
    expect(cables[0].properties.km).toBeGreaterThan(5000);
    const land = (lon: number) => lon === -5 || lon === -70;
    const station: OsmElement = { type: "node", id: 9, lat: 50.01, lon: -5.01, tags: { name: "Bude CLS" } };
    const lp = landingPointFeatures(cables, [station], land, 5);
    expect(lp.map((f) => f.properties)).toEqual([
      { n: "Bude CLS", cables: ["TAT-X"], k: "station" },
      { n: null, cables: ["TAT-X"], k: "cable-end" },
    ]);
  });

  it("classifies pipeline substances and skips water/sewage", () => {
    expect(pipelineSubstance({ substance: "gas" })).toBe("gas");
    expect(pipelineSubstance({ substance: "crude_oil" })).toBe("oil");
    expect(pipelineSubstance({ substance: "fuel" })).toBe("products");
    expect(pipelineSubstance({ substance: "water" })).toBeNull();
    expect(pipelineSubstance({ name: "Nord Stream" })).toBe("gas");
    expect(pipelineSubstance({ name: "Druzhba нефтепровод" })).toBe("oil");
    expect(pipelineSubstance({ name: "Aqueduct" })).toBeNull();
  });

  it("builds pipeline MultiLineStrings from route relations", () => {
    const rel: OsmElement = {
      type: "relation",
      id: 7,
      tags: { type: "route", route: "pipeline", substance: "gas", name: "Test line", operator: "Op" },
      members: [
        { type: "way", ref: 1, role: "", geometry: [{ lon: 10, lat: 50 }, { lon: 11, lat: 50 }] },
        { type: "way", ref: 2, role: "", geometry: [{ lon: 11, lat: 50 }, null, { lon: 12, lat: 50.5 }] },
        { type: "node", ref: 3, role: "" },
      ],
    };
    const short: OsmElement = { ...rel, id: 8, members: [{ type: "way", ref: 4, role: "", geometry: [{ lon: 0, lat: 0 }, { lon: 0.01, lat: 0 }] }] };
    const out = pipelineFeatures([rel, short]);
    expect(out).toHaveLength(1);
    expect(out[0].geometry.type).toBe("MultiLineString");
    expect(out[0].properties).toMatchObject({ n: "Test line", s: "gas", op: "Op", osm: "relation/7" });
  });

  it("builds de-duplicated point layers preferring named features", () => {
    const els: OsmElement[] = [
      { type: "node", id: 1, lat: 52, lon: 13, tags: { telecom: "data_center" } },
      { type: "way", id: 2, center: { lat: 52.0001, lon: 13.0001 }, tags: { telecom: "data_center", name: "DC Berlin", operator: "Acme" } },
      { type: "node", id: 3, lat: 0, lon: 0, tags: { telecom: "data_center", name: "Null Island" } },
    ];
    const dc = osmPointFeatures(els, dataCentreProps, 0.3);
    expect(dc.map((f) => f.properties)).toEqual([{ n: "DC Berlin", op: "Acme", osm: "way/2" }]);
    expect(baseProps({ military: "naval_base", name: "Base X" })).toEqual({ n: "Base X", k: "naval_base", op: null });
    expect(baseProps({ military: "range" })).toBeNull();
  });
});

describe("chokepoints", () => {
  it("lists the curated chokepoints with unique ids", () => {
    expect(CHOKEPOINTS.length).toBeGreaterThanOrEqual(13);
    expect(new Set(CHOKEPOINTS.map((c) => c.id)).size).toBe(CHOKEPOINTS.length);
    for (const c of ["hormuz", "bab-el-mandeb", "suez", "malacca", "bosporus", "panama", "gibraltar", "taiwan", "kerch", "dover", "danish", "lombok", "good-hope"])
      expect(CHOKEPOINTS.some((x) => x.id === c)).toBe(true);
  });
  it("draws closed circles of roughly the right radius", () => {
    const ring = circleRing(56.4, 26.5, 150);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lon, lat] of ring) expect(Math.abs(haversineKm(26.5, 56.4, lat, lon) - 150)).toBeLessThan(10);
    const fc = chokepointFeatures();
    expect(fc.features).toHaveLength(CHOKEPOINTS.length * 2);
  });
  it("scores disruption by importance, category and recency", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const ev = (type: "CONFLICT" | "SCIENCE", imp: number, hoursAgo: number) => ({ type, importanceScore: imp, timestamp: new Date(now - hoursAgo * 3_600_000).toISOString() });
    expect(disruptionScore([], now)).toBe(0);
    const conflict = disruptionScore([ev("CONFLICT", 90, 0)], now);
    expect(conflict).toBeGreaterThan(30);
    expect(disruptionScore([ev("SCIENCE", 90, 0)], now)).toBeLessThan(conflict);
    expect(disruptionScore([ev("CONFLICT", 90, 96)], now)).toBeLessThan(conflict / 2);
    expect(disruptionScore(Array.from({ length: 20 }, () => ev("CONFLICT", 90, 0)), now)).toBeLessThanOrEqual(100);
    expect([0, 20, 40, 80].map(disruptionLevel)).toEqual(["calm", "watch", "elevated", "high"]);
  });
  it("summarises events per chokepoint", () => {
    const now = Date.now();
    const s = chokepointStatus(CHOKEPOINTS[0], [
      { id: "a", type: "MARITIME", title: "Tanker seized", timestamp: new Date(now).toISOString(), importanceScore: 80, distanceKm: 20 },
      { id: "b", type: "MARITIME", title: "Drill", timestamp: new Date(now).toISOString(), importanceScore: 30, distanceKm: 50 },
    ], now);
    expect(s.total).toBe(2);
    expect(s.byCategory).toEqual({ MARITIME: 2 });
    expect(s.top[0].id).toBe("a");
  });
});

describe("catalog and built files", () => {
  it("every toggle has metadata and a known dataset", () => {
    expect(INFRA_LAYERS.map((l) => l.id)).toEqual([...INFRA_LAYER_IDS]);
    for (const l of INFRA_LAYERS) for (const s of l.sources) expect(INFRA_DATASETS[s]).toBeDefined();
  });
  it("built GeoJSON files exist, are valid and modest in size", () => {
    let total = 0;
    for (const file of new Set(INFRA_LAYERS.map((l) => l.file))) {
      if (!file) continue;
      const p = path.join(process.cwd(), "public", infraUrl(file));
      expect(existsSync(p), p).toBe(true);
      const raw = readFileSync(p, "utf8");
      total += raw.length;
      const fc = JSON.parse(raw) as GeoJSON.FeatureCollection;
      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features.length).toBeGreaterThan(10);
    }
    expect(total).toBeLessThan(6_000_000);
  });
});
