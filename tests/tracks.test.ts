import { describe, expect, it } from "vitest";
import { aisDimensions, decodeAisEta, etaFromParts, flagEmoji, mmsiInfo, shipTypeLabel } from "@/layers/maritime/mid";
import { AivdmDecoder, decodeAisPayload, nmeaChecksumOk } from "@/layers/maritime/nmea";
import { digitrafficStatic, parseAisMessage, parseAisStatic } from "@/layers/maritime/parser";
import { owCells, parseOpenWaters, parseOwEta } from "@/layers/maritime/openwaters";
import { adsbLolRow, cellQuery, inBbox, parseAdsbLol, viewportCells } from "@/layers/aircraft/parser";
import { airlineFromCallsign, categoryLabel, icaoCountry, squawkMeaning, typeName } from "@/layers/aircraft/reference";
import { TrailStore } from "@/layers/trails";
import { aircraftFeatures, highlightFeatures, orbitInfo, trackPosition } from "@/components/globe/tracking";

const NOW = Date.UTC(2026, 9, 8, 4, 0, 0);

describe("MMSI → flag", () => {
  it("reads the MID of ships and other station kinds", () => {
    expect(mmsiInfo(230629000)).toMatchObject({ mid: 230, country: "FI", countryName: "Finland", kind: "ship" });
    expect(mmsiInfo(636093290)).toMatchObject({ country: "LR", kind: "ship" });
    expect(mmsiInfo(538001234).country).toBe("MH");
    expect(mmsiInfo(366999999).country).toBe("US");
    expect(mmsiInfo(2320001)).toMatchObject({ mid: 232, country: "GB", kind: "coast station" }); // 002320001
    expect(mmsiInfo(992351234)).toMatchObject({ mid: 235, kind: "aid to navigation" });
    expect(mmsiInfo(111232001)).toMatchObject({ mid: 232, kind: "SAR aircraft" });
    expect(mmsiInfo(199999999).country).toBeNull();
    expect(mmsiInfo("abc").kind).toBe("other");
  });
  it("makes flag emoji", () => {
    expect(flagEmoji("NO")).toBe("🇳🇴");
    expect(flagEmoji(null)).toBe("");
  });
});

describe("AIS reference fields", () => {
  it("labels ship types", () => {
    expect(shipTypeLabel(70)).toBe("Cargo");
    expect(shipTypeLabel(82)).toBe("Tanker (hazardous cat. B)");
    expect(shipTypeLabel(52)).toBe("Tug");
    expect(shipTypeLabel(0)).toBeNull();
  });
  it("decodes the packed ETA and picks the right year", () => {
    expect(decodeAisEta(676928, NOW)).toBe("2026-10-10T17:00:00.000Z"); // month 10, day 10, 17:00
    expect(decodeAisEta(0, NOW)).toBeNull();
    expect(etaFromParts(1, 5, 12, 0, NOW)).toBe("2027-01-05T12:00:00.000Z");
    expect(etaFromParts(0, 5, 12, 0, NOW)).toBeNull();
    expect(etaFromParts(10, 5, 24, 60, NOW)).toBeNull();
  });
  it("derives dimensions from reference points", () => {
    expect(aisDimensions(203, 47, 25, 19)).toEqual({ lengthM: 250, beamM: 44 });
    expect(aisDimensions(0, 0, null, 3)).toEqual({ lengthM: null, beamM: null });
  });
  it("maps Digitraffic vessel metadata", () => {
    const st = digitrafficStatic({ mmsi: 1, name: "RAN DF ", callSign: "SVDU7", imo: 9953470, draught: 90, eta: 676928, referencePointA: 203, referencePointB: 47, referencePointC: 25, referencePointD: 19, shipType: 80 }, NOW);
    expect(st).toMatchObject({ name: "RAN DF", callSign: "SVDU7", imo: 9953470, draughtM: 9, lengthM: 250, beamM: 44, shipType: 80, eta: "2026-10-10T17:00:00.000Z" });
  });
  it("parses AISStream static data and class B positions", () => {
    const st = parseAisStatic(
      {
        MessageType: "ShipStaticData",
        MetaData: { MMSI: 244123456, latitude: 0, longitude: 0, time_utc: "" },
        Message: { ShipStaticData: { ImoNumber: 0, CallSign: "PD1 ", Name: "ANNA ", Type: 70, Dimension: { A: 100, B: 20, C: 8, D: 8 }, Eta: { Month: 10, Day: 9, Hour: 6, Minute: 30 }, MaximumStaticDraught: 6.5, Destination: "NLRTM" } },
      },
      NOW,
    );
    expect(st?.data).toMatchObject({ name: "ANNA", imo: null, callSign: "PD1", lengthM: 120, beamM: 16, draughtM: 6.5, destination: "NLRTM", eta: "2026-10-09T06:30:00.000Z" });
    const row = parseAisMessage({
      MessageType: "StandardClassBPositionReport",
      MetaData: { MMSI: 1, latitude: 59, longitude: 10, time_utc: "2026-10-08 04:00:00.000 +0000 UTC" },
      Message: { StandardClassBPositionReport: { Cog: 360, Sog: 4.2, TrueHeading: 511 } },
    });
    expect(row?.slice(2, 8)).toEqual([10, 59, 4.2, null, null, null]);
  });
});

describe("NMEA AIVDM decoder (gpsd test vectors)", () => {
  it("decodes a type 1 position report", () => {
    expect(decodeAisPayload("15RTgt0PAso;90TKcjM8h6g208CQ")).toMatchObject({ kind: "position", mmsi: 371798000, lat: 48.38163, lon: -123.39538, sog: 12.3, cog: 224, heading: 215, navStatus: 0 });
  });
  it("checks the checksum and reassembles a two-part type 5 with a tag block", () => {
    expect(nmeaChecksumOk("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C")).toBe(true);
    expect(nmeaChecksumOk("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5D")).toBe(false);
    const d = new AivdmDecoder();
    expect(d.line("\\s:2573345,c:1696250390*0E\\!AIVDM,2,1,1,A,55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp8,0*1C", NOW)).toBeNull();
    expect(d.line("!AIVDM,2,2,1,A,88888888880,2*25", NOW)).toMatchObject({
      kind: "static",
      mmsi: 351759000,
      imo: 9134270,
      callSign: "3FOF8",
      name: "EVER DIADEM",
      shipType: 70,
      dims: [225, 70, 1, 31],
      eta: { month: 5, day: 15, hour: 14, minute: 0 },
      draughtM: 12.2,
      destination: "NEW YORK",
    });
  });
});

describe("Open Waters AIS", () => {
  const raw = {
    features: [
      {
        geometry: { coordinates: [0.11416, 50.54384] as [number, number] },
        id: 563296400,
        properties: { mmsi: 563296400, kind: "vessel", name: "ONE RECOMMENDATION", callsign: "9V5126", imo: 9952713, type: 71, sog: 9.2, cog: 261.5, heading: 265, nav_status: 0, destination: "GBSOU", eta: "10-08 08:30", draught: 13.9, to_bow: 198, to_stern: 74, to_port: 29, to_starboard: 14, seen: "2026-10-08T03:59:00Z", source: "aishub" },
      },
      { geometry: { coordinates: [1, 50] as [number, number] }, properties: { mmsi: 992351000, kind: "aton", seen: "2026-10-08T03:59:00Z" } },
      { geometry: { coordinates: [1, 50] as [number, number] }, properties: { mmsi: 1, kind: "vessel", seen: "2026-10-07T00:00:00Z" } }, // stale
    ],
  };
  it("parses vessels with static data, skipping aids to navigation and stale reports", () => {
    const out = parseOpenWaters(raw, 3600_000, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].row).toEqual([563296400, "ONE RECOMMENDATION", 0.1142, 50.5438, 9.2, 261.5, 265, 0, Date.parse("2026-10-08T03:59:00Z"), 71, "GBSOU"]);
    expect(out[0].static).toMatchObject({ imo: 9952713, callSign: "9V5126", lengthM: 272, beamM: 43, draughtM: 13.9, eta: "2026-10-08T08:30:00.000Z" });
    expect(out[0].source).toBe("aishub");
    expect(parseOwEta("bad")).toBeNull();
  });
  it("plans at most N 10° cells, busiest first on wide views", () => {
    const near = owCells([-5, 48, 10, 56], 8);
    expect(near.truncated).toBe(false);
    expect(near.cells).toHaveLength(4);
    expect(near.cells[0]).toEqual({ key: "5:0", query: "50,0,60,10" });
    const wide = owCells([-180, -80, 180, 80], 4);
    expect(wide.truncated).toBe(true);
    expect(wide.cells).toHaveLength(4);
    // all chosen cells are in the busiest shipping areas
    for (const c of wide.cells) {
      const [la] = c.query.split(",").map(Number);
      expect(la).toBeGreaterThanOrEqual(-10);
    }
    expect(owCells([170, 0, -170, 10], 8).cells.map((c) => c.key).sort()).toEqual(["0:-18", "0:17"]);
  });
});

describe("adsb.lol aircraft", () => {
  const ac = { hex: "C06120", type: "adsb_icao", flight: "ACA866  ", r: "C-GKUH", t: "A333", alt_baro: 25450, gs: 436.4, track: 139.2, lat: 52.40941, lon: -2.09381, squawk: "5175", seen_pos: 0.4, category: "A5", dbFlags: 0 };
  it("turns a record into a row", () => {
    expect(adsbLolRow(ac)).toEqual(["c06120", "ACA866", "C-GKUH", "A333", -2.0938, 52.4094, 25450, false, 436, 139, "5175", 0, false]);
    expect(adsbLolRow({ ...ac, dbFlags: 1 })?.[12]).toBe(true);
    expect(adsbLolRow({ ...ac, track: undefined, true_heading: 90.4 })?.[9]).toBe(90);
  });
  it("drops ground stations, stale and unpositioned records; de-duplicates", () => {
    const rows = parseAdsbLol({
      ac: [ac, { ...ac, seen_pos: 5 }, { hex: "42584c", r: "TWR", t: "TWR", alt_baro: "ground", lat: 51, lon: 0 }, { hex: "111111", category: "C2", lat: 51, lon: 0 }, { hex: "222222" }, { hex: "333333", lat: 1, lon: 1, seen_pos: 500 }],
    });
    expect(rows.map((r) => r[0])).toEqual(["c06120"]);
    expect(rows[0][11]).toBe(0);
  });
  it("plans query cells around the view", () => {
    expect(cellQuery(8, 0)).toEqual({ key: "8:0", lat: 51, lon: 3, radiusNm: 217, bbox: [0, 48, 6, 54] });
    const v = viewportCells([-5, 48, 10, 56], 4);
    expect(v.truncated).toBe(true);
    expect(v.cells.map((c) => c.key)).toContain("8:0");
    expect(viewportCells([0, 48, 5, 53], 4)).toMatchObject({ truncated: false });
    expect(viewportCells([178, 10, -178, 12], 4).cells.map((c) => c.key).sort()).toEqual(["1:-30", "1:29"]);
    expect(inBbox(179, 11, [178, 10, -178, 12])).toBe(true);
    expect(inBbox(0, 11, [178, 10, -178, 12])).toBe(false);
  });
  it("reference lookups", () => {
    expect(icaoCountry("c06120")).toEqual({ code: "CA", name: "Canada" });
    expect(icaoCountry("4ca7b4")?.code).toBe("IE");
    expect(icaoCountry("a86e6c")?.code).toBe("US");
    expect(icaoCountry("zzzzzz")).toBeNull();
    expect(typeName("b77w")).toBe("Boeing 777-300ER");
    expect(airlineFromCallsign("BAW123")).toBe("British Airways");
    expect(airlineFromCallsign("N123AB")).toBeNull();
    expect(categoryLabel("A7")).toBe("Rotorcraft");
    expect(squawkMeaning("7700")).toBe("General emergency");
  });
  it("hides military-flagged aircraft from AIR when MIL is on", () => {
    const rows = parseAdsbLol({ ac: [ac, { ...ac, hex: "ae0001", dbFlags: 1 }] });
    expect(aircraftFeatures({ fields: [], rows }).features).toHaveLength(2);
    expect(aircraftFeatures({ fields: [], rows }, true).features.map((f) => f.properties?.hex)).toEqual(["c06120"]);
  });
});

describe("tracked objects", () => {
  it("keeps bounded trails", () => {
    const t = new TrailStore(3, 60_000, 10, 1_000);
    t.add("a", 0, 0, 0);
    t.add("a", 0, 0, 5_000); // same spot: only extends the time
    t.add("a", 1, 0, 500); // out of order / too close
    for (let i = 1; i <= 4; i++) t.add("a", i, i, 5_000 + i * 2_000);
    expect(t.get("a", 14_000)).toEqual([[2, 2, 9_000], [3, 3, 11_000], [4, 4, 13_000]]);
    expect(t.get("a", 200_000)).toEqual([]);
  });
  it("finds the selected object's position and draws highlight + trail", () => {
    const ships = { fields: [], rows: [[230629000, "VIKING GRACE", 22.5, 60.1, 12, 90, 88, 0, NOW, 60, "FITKU"]] as never, source: "keyless" as const };
    const aircraft = { fields: [], rows: parseAdsbLol({ ac: [{ hex: "abc123", lat: 50, lon: 1, track: 45 }] }) };
    const d = { ships, aircraft, mil: null, sats: [] };
    expect(trackPosition({ kind: "ship", id: "230629000" }, d)).toEqual({ lon: 22.5, lat: 60.1, heading: 88 });
    expect(trackPosition({ kind: "aircraft", id: "abc123" }, d)).toEqual({ lon: 1, lat: 50, heading: 45 });
    expect(trackPosition({ kind: "aircraft", id: "nope" }, d)).toBeNull();
    const fc = highlightFeatures({ lon: 2, lat: 2 }, { lon: 5, lat: 5 }, [[0, 0, 1], [1, 1, 2]]);
    expect(fc.features.map((f) => f.properties?.role)).toEqual(["trail", "hover", "selected"]);
    expect((fc.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
  it("computes orbit shape", () => {
    const o = orbitInfo({ meanMotion: 15.5, eccentricity: 0.0005, inclination: 51.64 });
    expect(o.periodMin).toBeCloseTo(92.9, 1);
    expect(o.apogeeKm).toBeGreaterThan(400);
    expect(o.perigeeKm).toBeLessThan(o.apogeeKm);
  });
});
