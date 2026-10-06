import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { localWallTime, magnitudeOf } from "@/data-sources/quake-common";
import { parseIso6709, parseJmaQuake } from "@/data-sources/jma-quake";
import { describeJmaVolcanoWarning, parseJmaVolcano } from "@/data-sources/jma-volcano";
import { bmkgPlace, bmkgTime, parseBmkg } from "@/data-sources/bmkg";
import { parseGeonet } from "@/data-sources/geonet";
import { afadTime, parseAfad } from "@/data-sources/afad";
import { parseSsnMexico, ssnPlace, ssnTime } from "@/data-sources/ssn-mexico";
import { categorizeHko, parseHko } from "@/data-sources/hko-warnings";
import { getConnector } from "@/data-sources/registry";

const now = Date.parse("2026-10-06T18:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("shared quake helpers", () => {
  it("converts fixed-offset wall clock times and reads magnitudes", () => {
    expect(localWallTime(2026, 10, 6, 20, 11, 23, 7).toISOString()).toBe("2026-10-06T13:11:23.000Z");
    expect(localWallTime(2026, 10, 1, 2, 0, 0, 9).toISOString()).toBe("2026-09-30T17:00:00.000Z"); // crosses a month
    expect(localWallTime(2026, 10, 6, 22, 0, 0, -6).toISOString()).toBe("2026-10-07T04:00:00.000Z"); // crosses a day
    expect(magnitudeOf("5.25")).toBe(5.3);
    expect(magnitudeOf("Ｍ不明")).toBeNull();
    expect(magnitudeOf("")).toBeNull();
  });
  it("registers every connector", () => {
    for (const id of ["jma-quake", "jma-volcano", "bmkg", "geonet", "afad", "ssn-mexico", "hko-warnings"]) expect(getConnector(id)?.mode).toBe("live");
  });
});

describe("JMA earthquakes", () => {
  it("parses ISO 6709 hypocentres", () => {
    expect(parseIso6709("+35.8+140.7-50000/")).toEqual({ lat: 35.8, lon: 140.7, depthKm: 50 });
    expect(parseIso6709("+32.6+130.7+0/")).toEqual({ lat: 32.6, lon: 130.7, depthKm: 0 });
    expect(parseIso6709("")).toBeNull();
  });
  it("merges bulletins per event, converts JST and keeps the max intensity", () => {
    const r = parseJmaQuake([
      { ctt: "20261007021000", eid: "20261007020150", rdt: "2026-10-07T02:10:00+09:00", at: "2026-10-07T02:01:00+09:00", en_anm: "Adjacent Sea of  Okinawa Main Island", cod: "+27.3+128.9-30000/", mag: "2.8", maxi: "1" },
      { ctt: "20261007020300", eid: "20261007020150", at: "2026-10-07T02:01:00+09:00", cod: "", mag: "", maxi: "5-" },
      { ctt: "20261007020000", eid: "20261007015900", at: "2026-10-07T01:59:00+09:00", cod: "", mag: "", maxi: "3" }, // intensity flash only
      { ctt: "20260901000000", eid: "20260901000000", at: "2026-09-01T00:00:00+09:00", cod: "+35+140-10000/", mag: "3.0", maxi: "1" }, // too old
    ], ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({
      title: "M 2.8 earthquake — Adjacent Sea of Okinawa Main Island",
      timestamp: "2026-10-06T17:01:00.000Z",
      latitude: 27.3,
      longitude: 128.9,
      metrics: { magnitude: 2.8, depth_km: 30, jma_max_intensity: "5 Lower" },
      source: { id: "jma-quake:20261007020150", assertion: "OFFICIAL_PRELIMINARY", publishedAt: "2026-10-06T17:10:00.000Z" },
    });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("JMA volcanic warnings", () => {
  it("describes levels and skips normal states", () => {
    expect(describeJmaVolcanoWarning("レベル３（入山規制）")).toMatchObject({ level: 3 });
    expect(describeJmaVolcanoWarning("レベル１（活火山であることに留意）")).toBeNull();
    expect(describeJmaVolcanoWarning("周辺海域警戒")?.label).toContain("marine");
  });
  it("joins warnings with volcano coordinates", () => {
    const w = (code: string, name: string, condition = "継続", at = "2026-09-12T09:30:00+09:00") => ({
      reportDatetime: at, eventId: code,
      volcanoInfos: [{ type: "噴火警報・予報（対象火山）", items: [{ name, code: "13", condition, areas: [{ name: "x", code }] }] }],
    });
    const r = parseJmaVolcano({
      warnings: [w("108", "レベル３（入山規制）", "引上げ"), w("509", "レベル１（活火山であることに留意）"), w("506", "レベル２（火口周辺規制）", "解除"), w("999", "レベル２（火口周辺規制）")],
      volcanoes: [{ code: "108", latlon: ["43.418", "142.686"], name_en: "Tokachidake" }, { code: "509", latlon: ["30.443", "130.217"] }, { code: "506", latlon: ["31.593", "130.657"] }],
    }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(3);
    expect(r.candidates[0]).toMatchObject({ title: "Tokachidake volcano — JMA level 3 (do not approach the volcano)", timestamp: "2026-09-12T00:30:00.000Z", country: "JP", latitude: 43.418, metrics: { alert_level: 3, condition: "raised" } });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("BMKG earthquakes", () => {
  it("converts WIB/WITA/WIT local times when DateTime is missing", () => {
    expect(bmkgTime({ Tanggal: "06 Okt 2026", Jam: "20:11:23 WIB" })?.toISOString()).toBe("2026-10-06T13:11:23.000Z");
    expect(bmkgTime({ Tanggal: "04 Okt 2026", Jam: "06:37:31 WIB" })?.toISOString()).toBe("2026-10-03T23:37:31.000Z");
    expect(bmkgTime({ Tanggal: "1 Agu 2026", Jam: "08:00:00 WIT" })?.toISOString()).toBe("2026-07-31T23:00:00.000Z");
    expect(bmkgTime({ Tanggal: "1 Des 2026", Jam: "12:00:00 WITA" })?.toISOString()).toBe("2026-12-01T04:00:00.000Z");
    expect(bmkgTime({ DateTime: "2026-10-06T13:11:23+00:00", Jam: "nonsense" })?.toISOString()).toBe("2026-10-06T13:11:23.000Z");
    expect(bmkgTime({ Tanggal: "06 Okt 2026" })).toBeNull();
  });
  it("translates place descriptions", () => {
    expect(bmkgPlace("219 km TimurLaut TARAKAN-KALTARA")).toBe("219 km NE of Tarakan-Kaltara");
    expect(bmkgPlace("Pusat gempa berada di laut 35 km barat daya Sumur")).toBe("35 km SW of Sumur");
  });
  it("merges the M5+ and felt lists by origin time", () => {
    const base = { Tanggal: "06 Okt 2026", Jam: "20:11:23 WIB", DateTime: "2026-10-06T13:11:23+00:00", Coordinates: "4.94,118.77", Magnitude: "5.3", Kedalaman: "10 km" };
    const r = parseBmkg({
      latest: [{ ...base, Wilayah: "219 km TimurLaut TARAKAN-KALTARA", Potensi: "Tidak berpotensi tsunami" }],
      felt: [
        { ...base, Wilayah: "Pusat gempa berada di laut 219 Km timur laut Tarakan", Dirasakan: "II-III Tarakan" },
        { Tanggal: "06 Okt 2026", Jam: "20:53:22 WIB", Coordinates: "-6.90,105.36", Magnitude: "3.9", Kedalaman: "28 km", Wilayah: "x", Dirasakan: "II-III Sumur" },
        { Tanggal: "06 Okt 2026", Jam: "20:00:00 WIB", Magnitude: "3.0" }, // no coordinates
      ],
    }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ title: "M 5.3 earthquake — 219 km NE of Tarakan-Kaltara", timestamp: "2026-10-06T13:11:23.000Z", metrics: { felt_mmi: "II-III Tarakan", depth_km: 10 } });
    expect(r.candidates[0].summary).toContain("no tsunami potential");
    expect(r.candidates[1].timestamp).toBe("2026-10-06T13:53:22.000Z");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("GeoNet earthquakes", () => {
  it("skips deleted and old solutions and maps quality", () => {
    const f = (publicID: string, time: string, quality: string) => ({ geometry: { type: "Point", coordinates: [175.749, -40.782] as [number, number] }, properties: { publicID, time, depth: 22.4, magnitude: 2.6705, mmi: 3, locality: "15 km south of Eketahuna", quality } });
    const r = parseGeonet({ features: [f("a", "2026-10-05T11:10:12.867Z", "best"), f("b", "2026-10-06T11:00:00Z", "preliminary"), f("c", "2026-10-05T11:00:00Z", "deleted"), f("d", "2026-09-01T00:00:00Z", "best")] }, ctx);
    expect(r.candidates.map((c) => c.source.assertion)).toEqual(["OFFICIAL_FINAL", "OFFICIAL_PRELIMINARY"]);
    expect(r.candidates[0]).toMatchObject({ title: "M 2.7 earthquake — 15 km south of Eketahuna, New Zealand", timestamp: "2026-10-05T11:10:12.867Z", metrics: { mmi: 3 } });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("AFAD earthquakes", () => {
  it("reads zone-less dates as UTC", () => {
    expect(afadTime("2026-10-04T22:51:29")?.toISOString()).toBe("2026-10-04T22:51:29.000Z");
    expect(afadTime("2026-10-04T22:51:29+03:00")?.toISOString()).toBe("2026-10-04T19:51:29.000Z");
    expect(afadTime(null)).toBeNull();
  });
  it("parses events", () => {
    const r = parseAfad([
      { eventID: "730440", location: "Saimbeyli (Adana)", latitude: "37.75833", longitude: "36.0965", depth: "7", type: "MW", magnitude: "4.1", country: "Türkiye", date: "2026-10-04T22:51:29" },
      { eventID: "x", location: "Ege Denizi", latitude: "38.1", longitude: "26.0", depth: "10", type: "ML", magnitude: "3.2", country: "", date: "2026-10-05T01:00:00" },
      { eventID: "y", latitude: "", longitude: "", date: "2026-10-05T01:00:00" },
    ], ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ title: "M 4.1 earthquake — Saimbeyli (Adana), Türkiye", country: "TR", timestamp: "2026-10-04T22:51:29.000Z", metrics: { magnitude_type: "MW" } });
    expect(r.candidates[1].country).toBeNull();
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("SSN Mexico earthquakes", () => {
  it("converts Mexico time (UTC−6) and tidies places", () => {
    expect(ssnTime("Fecha:2026-10-06 04:23:38 (Hora de México)")?.toISOString()).toBe("2026-10-06T10:23:38.000Z");
    expect(ssnTime("Fecha:2026-12-31 20:00:00 (Hora de México)")?.toISOString()).toBe("2027-01-01T02:00:00.000Z");
    expect(ssnPlace("46 km al SURESTE de  SAYULA DE ALEMAN, VER")).toBe("46 km al sureste de Sayula de Aleman, VER");
  });
  it("parses the RSS feed", () => {
    const item = (title: string, fecha: string, lat: string, lon: string) => `<item><title>${title}</title><description><![CDATA[ <p>Fecha:${fecha} (Hora de M&eacute;xico)<br/>Lat/Lon: ${lat}/${lon}<br/>Profundidad: 14.3 km </p> ]]></description><link><![CDATA[ http://www2.ssn.unam.mx:8080/jsp/localizacion-de-sismo.jsp?latitud=${lat}&evento=1 ]]></link><geo:lat>${lat}</geo:lat><geo:long>${lon}</geo:long></item>`;
    const xml = `<rss><channel>${item("3.5, 46 km al NOROESTE de  VICENTE GUERRERO, BC", "2026-10-06 04:23:38", "30.952", "-116.397")}${item("3.1, 10 km al SUR de X, OAX", "sin fecha", "16.1", "-97.1")}</channel></rss>`;
    const r = parseSsnMexico(xml, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0]).toMatchObject({ title: "M 3.5 earthquake — 46 km al noroeste de Vicente Guerrero, BC, México", timestamp: "2026-10-06T10:23:38.000Z", latitude: 30.952, metrics: { depth_km: 14.3 } });
    expect(r.candidates[0].source.sourceUrl).toMatch(/^http:\/\/www2\.ssn\.unam\.mx/);
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Hong Kong Observatory warnings", () => {
  it("parses warnings in force with HKT → UTC times and skips cancelled ones", () => {
    const r = parseHko({
      summary: {
        WTCSGNL: { name: "Tropical Cyclone Warning Signal", code: "TC8NE", actionCode: "ISSUE", issueTime: "2026-10-06T07:40:00+08:00", updateTime: "2026-10-06T07:40:00+08:00" },
        WRAIN: { name: "Rainstorm Warning Signal", code: "WRAINA", type: "Amber", actionCode: "CANCEL", issueTime: "2026-10-06T05:00:00+08:00" },
        WFIRE: { name: "Fire Danger Warning", code: "WFIRER", type: "Red", actionCode: "ISSUE", issueTime: "2026-10-05T07:00:00+08:00", expireTime: "2026-10-05T12:00:00+08:00" },
      },
      details: [{ warningStatementCode: "WTCSGNL", contents: ["The No. 8 Northeast Gale or Storm Signal is in force."] }],
    }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0]).toMatchObject({
      type: "WEATHER", subtype: "tropical-cyclone", country: "HK", geoPrecision: "city",
      title: "Tropical Cyclone Warning Signal — No. 8 Northeast Gale or Storm Signal — Hong Kong",
      timestamp: "2026-10-05T23:40:00.000Z",
      description: "The No. 8 Northeast Gale or Storm Signal is in force.",
    });
    expect(categorizeHko("WFNTSA").type).toBe("FLOOD");
    expect(valid(r.candidates)).toBe(true);
  });
});
