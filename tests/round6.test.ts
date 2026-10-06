import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { categorizeEccc, parseEccc } from "@/data-sources/eccc";
import { parseAuEmergency, pointOf, rfsDate, rfsFields } from "@/data-sources/au-emergency";
import { buildEvents } from "@/lib/finance/prediction-markets";
import { parseRegistrations, splitDisplayName } from "@/lib/finance/ipos";

const now = Date.parse("2026-10-06T06:30:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);
const square = { type: "Polygon" as const, coordinates: [[[-59, 48], [-58, 48], [-58, 49], [-59, 49], [-59, 48]]] as [number, number][][] };

describe("Canada warnings", () => {
  it("keeps active warnings with their polygon, issue time and end time", () => {
    const p = { alert_type: "warning", alert_name_en: "wind warning", publication_datetime: "2026-10-06T05:48:10Z", validity_datetime: "2026-10-06T12:00:00Z", event_end_datetime: "2026-10-07T00:00:00Z", feature_name_en: "Bay St. George", province: "NL", status_en: "active" };
    const r = parseEccc({ features: [
      { id: "a", geometry: square, properties: p },
      { id: "b", geometry: square, properties: { ...p, status_en: "ended" } },
      { id: "c", geometry: square, properties: { ...p, alert_type: "watch" } },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ title: "Wind warning — Bay St. George, Newfoundland and Labrador", timestamp: "2026-10-06T05:48:10.000Z", resolvedAt: "2026-10-07T00:00:00.000Z", country: "CA" });
    expect(r.candidates[0].geometry).toBeTruthy();
    expect(categorizeEccc("storm surge warning").type).toBe("FLOOD");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Australian emergencies", () => {
  it("parses RFS descriptions and day/month UTC dates", () => {
    expect(rfsFields("ALERT LEVEL: Advice <br />TYPE: Bush Fire <br />SIZE: 26 ha")).toEqual({ "ALERT LEVEL": "Advice", TYPE: "Bush Fire", SIZE: "26 ha" });
    expect(rfsDate("6/10/2026 5:21:00 AM")?.toISOString()).toBe("2026-10-06T05:21:00.000Z");
    expect(rfsDate("6/10/2026 5:21:00 PM")?.toISOString()).toBe("2026-10-06T17:21:00.000Z");
    expect(pointOf({ type: "GeometryCollection", geometries: [{ type: "Polygon", coordinates: square.coordinates }, { type: "Point", coordinates: [153.2, -29.0] }] })).toEqual([153.2, -29.0]);
  });
  it("keeps significant fires and official warnings only", () => {
    const rfs = (category: string, desc: string) => ({ geometry: { type: "Point", coordinates: [153.2, -29.0] }, properties: { title: "BORA CODRINGTON RD, BORA RIDGE", category, guid: "https://x/1", pubDate: "6/10/2026 5:21:00 AM", description: desc } });
    const vic = (props: Record<string, unknown>) => ({ geometry: { type: "Point", coordinates: [143.8, -38.2] }, properties: { id: "1", location: "Barwon River to Inverleigh", created: "2026-10-06T12:41:23+11:00", ...props } });
    const r = parseAuEmergency({
      nsw: [rfs("Advice", "ALERT LEVEL: Advice <br />TYPE: Bush Fire <br />SIZE: 26 ha"), rfs("Planned Burn", "TYPE: Hazard Reduction <br />SIZE: 200 ha"), rfs("Not Applicable", "TYPE: Grass Fire <br />SIZE: 2 ha")],
      vic: [vic({ feedType: "warning", name: "Watch and Act", category1: "Watch and Act", cap: { event: "Riverine Flood", severity: "Moderate" } }), vic({ id: "2", feedType: "incident", category1: "Fire", category2: "Other", status: "Safe" })],
    }, ctx);
    expect(r.candidates.map((c) => c.type)).toEqual(["FIRE", "FLOOD"]);
    expect(r.candidates[1].timestamp).toBe("2026-10-06T01:41:23.000Z");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("prediction markets", () => {
  it("groups by topic, drops sports and ranks outcomes", () => {
    const ev = (event_ticker: string, category: string, vol: string) => ({ event_ticker, title: event_ticker, category, markets: [
      { yes_sub_title: "Cut 25bp", last_price_dollars: "0.62", previous_price_dollars: "0.55", volume_24h_fp: vol },
      { yes_sub_title: "Hold", last_price_dollars: "0.35", previous_price_dollars: "0.40", volume_24h_fp: "1" },
    ] });
    const out = buildEvents([ev("FED", "Economics", "500"), ev("NFL", "Sports", "9999"), ev("CPI", "Economics", "900")]);
    expect(out.map((e) => e.ticker)).toEqual(["CPI", "FED"]);
    expect(out[0].outcomes[0]).toEqual({ label: "Cut 25bp", prob: 0.62, change: 0.07 });
  });
});

describe("registration statements", () => {
  it("splits names and flags likely IPOs", () => {
    expect(splitDisplayName("Propanc Biopharma, Inc.  (PPCB)  (CIK 0001517681)")).toEqual({ name: "Propanc Biopharma, Inc.", ticker: "PPCB", cik: "0001517681" });
    const r = parseRegistrations([
      { _id: "0001628280-26-064973:lycia-s1.htm", _source: { form: "S-1", file_date: "2026-10-05", display_names: ["Lycia Therapeutics, Inc.  (CIK 0001806540)"], adsh: "0001628280-26-064973", biz_locations: ["South San Francisco, CA"] } },
      { _id: "x:y.htm", _source: { form: "S-1/A", file_date: "2026-10-05", display_names: ["Amended Co  (CIK 1)"], adsh: "x" } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ company: "Lycia Therapeutics, Inc.", likelyIpo: true, url: "https://www.sec.gov/Archives/edgar/data/1806540/000162828026064973/lycia-s1.htm" });
  });
});
