import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { parseAgencyFeeds } from "@/data-sources/agency-feeds/common";
import { fdsnTime, parseIngv, readFdsnText } from "@/data-sources/ingv";
import { nrcanKind, parseNrcan } from "@/data-sources/nrcan-quakes";
import { ignTime, parseIgn, readIgnXml } from "@/data-sources/ign-spain";
import { inmetEvent, inmetTime, parseInmet } from "@/data-sources/inmet-alerts";
import { parseEffis } from "@/data-sources/effis-burnt-areas";
import { cadTime, parseCad, sizeFromH } from "@/data-sources/cneos-close-approaches";
import { panamaSpec, stripTracking } from "@/data-sources/panama-canal";
import { afroDisease, afroSpec } from "@/data-sources/who-afro";
import { esaSite, esaSpec } from "@/data-sources/esa-news";
import { ecbStatKind, ecbStatSpec } from "@/data-sources/ecb-statistics";
import { routeQuestion } from "@/lib/analyst/router";

const now = Date.parse("2026-11-07T08:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

const NEW_IDS = ["ingv", "ign-spain", "nrcan-quakes", "inmet-alerts", "effis-burnt-areas", "cneos-close-approaches", "panama-canal", "who-afro", "esa-news", "ecb-statistics"];

describe("registry (batch 5)", () => {
  it("registers the new connectors as live with sane refresh intervals", () => {
    for (const id of NEW_IDS) {
      const c = getConnector(id);
      expect(c, id).toBeDefined();
      expect(c!.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    }
  });
  it("routes analyst questions to the new sources", () => {
    const sources = (q: string) => routeQuestion(q, { watchlist: [] }).map((c) => (c.args as { source?: string }).source).filter(Boolean);
    expect(sources("Any earthquakes in Italy today?")).toContain("ingv");
    expect(sources("Was there an earthquake in Spain?")).toContain("ign-spain");
    expect(sources("induced earthquakes in Alberta")).toContain("nrcan-quakes");
    expect(sources("weather warnings in Brazil")).toContain("inmet-alerts");
    expect(sources("Portugal wildfires burnt area")).toContain("effis-burnt-areas");
    expect(sources("any asteroid close approaches this month?")).toContain("cneos-close-approaches");
    expect(sources("Panama Canal draft restrictions")).toContain("panama-canal");
    expect(sources("Ebola outbreak in Uganda")).toContain("who-afro");
    expect(sources("latest ESA news")).toContain("esa-news");
    expect(sources("euro area M3 money supply")).toContain("ecb-statistics");
  });
});

describe("ingv", () => {
  const text = [
    "#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
    "47870842|2026-11-05T17:53:41.100000|38.0757|14.2875|4.2|SURVEY-INGV||||ML|2.8|--|Costa Siciliana nord-orientale (Messina)|earthquake",
    "47861452|2026-11-04T06:09:26.100000|38.577|16.470667|38.2|rei#REI||||ML|3.6|--|5 km W Badolato (CZ)|earthquake",
    "47020191|2026-11-06T10:39:24.950000|34.9699|142.449|9.0|SURVEY-INGV-A||||Mwp|6.1|--|Off east coast of Honshu, Japan [Sea: Japan]|earthquake",
    "47866000|2026-11-05T05:11:59.660000|44.4365|9.7365|2.7|SURVEY-INGV||||ML|2.2|--|3 km E Albareto (PR)|earthquake",
    "47866001|2026-11-05T05:11:59.660000|44.4365|9.7365|0|SURVEY-INGV||||ML|2.9|--|Cava (PR)|quarry blast",
  ].join("\n");
  it("reads FDSN text by header columns; times without Z are UTC", () => {
    const { rows } = readFdsnText(text);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ id: "47870842", mag: 2.8, magType: "ML", depthKm: 4.2, place: "Costa Siciliana nord-orientale (Messina)" });
    expect(new Date(fdsnTime(rows[0].time)).toISOString()).toBe("2026-11-05T17:53:41.100Z");
  });
  it("keeps Italian-area M2.5+ earthquakes only", () => {
    const r = parseIngv({ text }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(3); // Japan (outside box), M2.2, quarry blast
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].title).toBe("M 2.8 earthquake — Costa Siciliana nord-orientale (Messina)");
    expect(r.candidates[0].source.sourceUrl).toBe("https://terremoti.ingv.it/event/47870842");
  });
});

describe("nrcan-quakes", () => {
  const text = [
    "#EventID|Time|Latitude|Longitude|Depth/km|MagType|Magnitude|EventLocationName",
    "ca2026vzru|2026-11-06T12:31:09.000Z|49.5804|-128.189|10|Mw'|2.85|107 km SSW of Port Alice, BC/107 km SSO de Port Alice, BC",
    "ca2026vxau|2026-11-05T02:01:50.000Z|54.5418|-117.3164|3.14|MLy|3.21|Suspected industry-related event, 37 km WNW of Fox Creek, AB/Événement lié à l'industrie soupçonné, 37 km ONO de Fox Creek, AB",
    "ca2026vune|2026-11-03T17:13:47.000Z|54.0628|-119.1673|0|ML|3.14|Quarry blast, 20 km N of Grande Cache, AB/Dynamitage de carrière, 20 km N de Grande Cache, AB",
    "ca2026vtat|2026-11-02T22:02:17.000Z|54.5254|-117.2895|1|MLy|2.16|34 km WNW of Fox Creek, AB/34 km ONO de Fox Creek, AB",
  ].join("\n");
  it("skips blasts and small events, labels induced ones, shows the English place", () => {
    expect(nrcanKind("Quarry blast, 3 km SE of Willow Creek Mine, BC")).toBe("blast");
    expect(nrcanKind("Mining-related event, Esterhazy mine, SK, felt")).toBe("induced");
    const r = parseNrcan({ text }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].title).toBe("M 2.9 earthquake — 107 km SSW of Port Alice, BC");
    expect(r.candidates[0].metrics!.magnitude_type).toBe("Mw");
    const ind = r.candidates[1];
    expect(ind.subtype).toBe("induced earthquake");
    expect(ind.locationName).toBe("37 km WNW of Fox Creek, AB");
    expect(ind.summary).toContain("Suspected industry-related event");
  });
});

describe("ign-spain", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" version="2.0"><channel><title>GeoRSS Sismología IGN</title>
    <item><title>-Info.terremoto: 06/11/2026 8:09:09</title><link>http://www.ign.es/web/ign/portal/sis-catalogo-terremotos/-/catalogo-terremotos/detailTerremoto?evid=es2026vthtd</link>
    <description>Se ha producido un terremoto de magnitud 2.6 en ALBORÁN NORTE en la fecha 06/11/2026 8:09:09 en la siguiente localización: 36.5944,-3.0668</description><geo:lat>36.5944</geo:lat><geo:long>-3.0668</geo:long></item>
    <item><title>-Info.terremoto: 28/10/2026 1:00:00</title><link>http://www.ign.es/x?evid=es2026old</link>
    <description>Se ha producido un terremoto de magnitud 3.4 en GOLFO DE CÁDIZ en la fecha 28/10/2026 1:00:00 en la siguiente localización: 36.1,-7.5</description><geo:lat>36.1</geo:lat><geo:long>-7.5</geo:long></item>
    <item><title>-Info.terremoto: 05/11/2026 3:00:00</title><link>http://www.ign.es/x?evid=es2026small</link>
    <description>Se ha producido un terremoto de magnitud 1.9 en TENERIFE en la fecha 05/11/2026 3:00:00 en la siguiente localización: 28.3,-16.6</description><geo:lat>28.3</geo:lat><geo:long>-16.6</geo:long></item>
  </channel></rss>`;
  it("reads GeoRSS items and parses magnitude, place and UTC time from the description", () => {
    const items = readIgnXml(xml);
    expect(items).toHaveLength(3);
    expect(new Date(ignTime("06/11/2026 8:09:09")).toISOString()).toBe("2026-11-06T08:09:09.000Z");
    const r = parseIgn({ items }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2); // older than 3 days, M1.9
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.title).toBe("M 2.6 earthquake — ALBORÁN NORTE");
    expect(c.source.externalId).toBe("es2026vthtd");
    expect(c.source.sourceUrl).toMatch(/^https:\/\/www\.ign\.es\//);
  });
});

describe("inmet-alerts", () => {
  const poly = JSON.stringify({ type: "Polygon", coordinates: [[[-53, -27], [-50, -27], [-50, -25], [-53, -25], [-53, -27]]] });
  const aviso = (o: Record<string, unknown>) => ({
    id: 56300, id_aviso: 28640, id_sequencia: 1, inicio: "2026-11-07 00:00", fim: "2026-11-07 23:59", poligono: poly,
    estados: "Santa Catarina,Rio Grande do Sul,Paraná", mesorregioes: "Oeste Catarinense,Noroeste Rio-grandense", municipios: "Chapecó - SC (4204202),Erechim - RS (4307005)",
    descricao: "Tempestade", severidade: "Grande Perigo", riscos: ["Grande risco de cortes de energia elétrica."], encerrado: false, ...o,
  });
  it("translates event names and reads Brasília times", () => {
    expect(inmetEvent("Acumulado de Chuva").en).toBe("Heavy rainfall accumulation");
    expect(inmetEvent("Declínio de Temperatura").subtype).toBe("winter");
    expect(inmetTime("2026-11-07 00:01")).toBe("2026-11-07T03:01:00.000Z");
  });
  it("keeps orange/red warnings with polygons and supersedes earlier sequences", () => {
    const r = parseInmet(
      {
        hoje: [aviso({}), aviso({ id: 56301, id_aviso: 28641, severidade: "Perigo Potencial" }), aviso({ id: 56302, id_aviso: 28642, poligono: null })],
        futuro: [aviso({ id: 56303, id_aviso: 28643, id_sequencia: 2, severidade: "Perigo", descricao: "Vendaval", inicio: "2026-11-08 00:00", fim: "2026-11-08 23:59" }), aviso({ id: 56304, id_aviso: 28644, fim: "2026-11-06 12:00" })],
      },
      ctx,
    );
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(3); // yellow, no polygon, ended
    expect(valid(r.candidates)).toBe(true);
    const red = r.candidates[0];
    expect(red.title).toBe("Storm warning (red) — Santa Catarina, Rio Grande do Sul, Paraná, Brazil");
    expect(red.country).toBe("BR");
    expect(red.geometry?.type).toBe("Polygon");
    expect(red.latitude).toBeLessThan(-25);
    expect(red.summary).toContain("2 municipalities");
    const gale = r.candidates[1];
    expect(gale.summary).toContain("issued an orange-level warning");
    expect(gale.supersedes).toEqual(["inmet-alerts:28643.1"]);
  });
});

describe("effis-burnt-areas", () => {
  const area = (o: Record<string, unknown>) => ({
    id: 871176, centroid: { type: "Point", coordinates: [-7.53, 40.69] },
    shape: { type: "MultiPolygon", coordinates: [[[[-7.55, 40.68], [-7.51, 40.68], [-7.51, 40.70], [-7.55, 40.70], [-7.55, 40.68]]]] },
    country: "PT", countryful: "Portugal", province: "Beiras e Serra da Estrela", commune: "Maceira", firedate: "2026-11-03T01:21:00+01:00",
    lastupdate: "2026-11-03T08:36:50.949183+01:00", area_ha: 1327, broadlea: "10.5", conifer: "40.25", mixed: "0", scleroph: "30", transit: "19.25", othernatlc: "0", agriareas: "0", artifsurf: "0", otherlc: "0", percna2k: "12.0", noneu: false, ...o,
  });
  it("builds one FIRE event per mapped burnt area of 50 ha+, with perimeter and land cover", () => {
    const r = parseEffis({ results: [area({}), area({ id: 2, area_ha: 30 }), area({ id: 3, firedate: "2026-10-01T00:00:00+02:00" }), area({ id: 4, country: "BA", countryful: "Bosnia and Herzegovina", province: "Čapljina", commune: "N.A.", noneu: true })] } as never, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.title).toBe("Burnt area of 1,327 ha — Maceira, Beiras e Serra da Estrela, Portugal");
    expect(c.timestamp).toBe("2026-11-03T00:21:00.000Z");
    expect(c.summary).toContain("40.3% coniferous forest");
    expect(c.summary).toContain("12% inside Natura 2000");
    expect(c.metrics!.forest_pct).toBeCloseTo(50.8, 1);
    expect(c.source.assertion).toBe("MEASUREMENT");
    expect(r.candidates[1].locationName).toBe("Čapljina, Bosnia and Herzegovina");
  });
});

describe("cneos-close-approaches", () => {
  const fields = ["des", "orbit_id", "jd", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h", "diameter", "diameter_sigma", "fullname"];
  const raw = {
    fields,
    data: [
      ["2026 VY2", "2", "2461345.29", "2026-Oct-31 19:10", "0.000757706791831069", "0", "0", "6.88117082089571", "6.3", "< 00:01", "29.031", null, null, "       (2026 VY2)"],
      ["2026 VZ9", "1", "2461360.0", "2026-Nov-20 05:00", "0.0012", "0", "0", "11.2", "11", "00:05", "25.2", null, null, "       (2026 VZ9)"],
      ["2026 OLD", "1", "2461300.0", "2026-Oct-10 05:00", "0.0012", "0", "0", "11.2", "11", "00:05", "25.2", null, null, "(2026 OLD)"],
      ["99942", "1", "2461360.0", "2026-Nov-10 05:00", "0.003", "0", "0", "7", "7", "00:01", "19.1", "0.34", null, "  99942 Apophis (2004 MN4)"],
    ],
  };
  it("reads CAD times and estimates size from H", () => {
    expect(new Date(cadTime("2026-Oct-31 19:10")).toISOString()).toBe("2026-10-31T19:10:00.000Z");
    const [a, b] = sizeFromH(29.031);
    expect(a).toBeGreaterThan(3);
    expect(b).toBeLessThan(10);
  });
  it("keeps approaches within 1 LD in the window; past = final, future = scheduled", () => {
    const r = parseCad(raw, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2); // too old, beyond 1 LD
    expect(valid(r.candidates)).toBe(true);
    const past = r.candidates[0];
    expect(past.title).toBe("Asteroid 2026 VY2 passed Earth at 0.29 lunar distances");
    expect(past.source.assertion).toBe("OFFICIAL_FINAL");
    expect(past.metrics!.distance_km).toBe(113351);
    expect(past.summary).toMatch(/estimated \d+ m–\d+ m across/);
    const next = r.candidates[1];
    expect(next.title).toContain("will pass");
    expect(next.source.assertion).toBe("SCHEDULED");
  });
});

describe("agency feeds (batch 5)", () => {
  const rss = (items: Array<[string, string, string, string?]>) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map(([t, l, d, desc]) => `<item><title><![CDATA[${t}]]></title><link>${l}</link><pubDate>${d}</pubDate><description>${desc ?? ""}</description></item>`).join("")}</channel></rss>`;

  it("panama-canal: strips tracking parameters and labels operational releases", () => {
    expect(stripTracking("https://pancanal.com/en/x/?utm_source=rss&utm_medium=rss")).toBe("https://pancanal.com/en/x/");
    const xml = rss([
      ["Panama Canal announces increase in draft and daily transit", "https://pancanal.com/en/a/", "Wed, 04 Nov 2026 16:14:59 +0000"],
      ["Panama Canal Holds Its 41st Advisory Board Meeting", "https://pancanal.com/en/b/", "Mon, 26 Oct 2026 21:59:12 +0000"],
      ["Old news", "https://pancanal.com/en/c/", "Mon, 01 Sep 2026 10:00:00 +0000"],
    ]);
    const r = parseAgencyFeeds(panamaSpec, { feeds: [{ feed: "acp", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].subtype).toBe("canal operations");
    expect(r.candidates[0].type).toBe("MARITIME");
    expect(r.candidates[0].country).toBe("PA");
    expect(r.candidates[1].subtype).toBe("canal authority news");
  });

  it("who-afro: keeps outbreak items only, one per title, in the country named", () => {
    expect(afroDisease("Uganda scales up Bundibugyo virus disease response")).toBe("bundibugyo virus disease");
    const xml = rss([
      ["South Sudan conducts nationwide polio vaccination campaign targeting 3.9 million children", "https://www.afro.who.int/a", "Fri, 06 Nov 2026 06:43:36 +0000"],
      ["South Sudan conducts nationwide polio vaccination campaign targeting 3.9 million children", "https://www.afro.who.int/a-dup", "Fri, 06 Nov 2026 06:44:36 +0000"],
      ["WHO Delivers 24 Wheelchairs During World Polio Day Commemoration in Ethiopia", "https://www.afro.who.int/b", "Fri, 06 Nov 2026 16:45:48 +0000"],
      ["Community surveys contribute to behaviour change in response to Bundibugyo virus disease", "https://www.afro.who.int/c", "Wed, 04 Nov 2026 06:36:10 +0000"],
    ]);
    const r = parseAgencyFeeds(afroSpec, { feeds: [{ feed: "afro", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].country).toBe("SS");
    expect(r.candidates[0].subtype).toBe("polio (WHO Africa)");
    expect(r.candidates[1].country).toBe("CG"); // regional office
    expect(r.candidates[1].title).toMatch(/^WHO Africa: /);
  });

  it("esa-news: places at a named ESA site, else HQ; skips media notices", () => {
    expect(esaSite("Ariane 6 launches Sentinel-1D from Kourou")?.country).toBe("FR");
    const xml = rss([
      ["Euclid discovers new comet", "https://www.esa.int/a", "Fri, 06 Nov 2026 08:24:42 +0000"],
      ["ESOC flight controllers prepare for Hera arrival", "https://www.esa.int/b", "Thu, 05 Nov 2026 08:00:00 +0000"],
      ["Media invited to ESA ministerial briefing", "https://www.esa.int/c", "Thu, 05 Nov 2026 09:00:00 +0000"],
    ]);
    const r = parseAgencyFeeds(esaSpec, { feeds: [{ feed: "top", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].title).toBe("ESA: Euclid discovers new comet");
    expect(r.candidates[0].type).toBe("SPACE");
    expect(r.candidates[0].country).toBe("FR");
    expect(r.candidates[1].country).toBe("DE");
  });

  it("ecb-statistics: classifies releases and renames meeting accounts", () => {
    expect(ecbStatKind("Euro area monthly balance of payments: August 2026", "https://www.ecb.europa.eu/press/stats/bop/x").subtype).toBe("balance of payments");
    const xml = rss([
      [" Monetary developments in the euro area: September 2026", "https://www.ecb.europa.eu/press/stats/md/html/ecb.md2609.en.html", "Tue, 27 Oct 2026 10:00:00 +0100"],
      [" Meeting of 9-10 September 2026", "https://www.ecb.europa.eu/press/accounts/2026/html/ecb.mg261008.en.html", "Thu, 29 Oct 2026 13:30:00 +0200"],
    ]);
    const r = parseAgencyFeeds(ecbStatSpec, { feeds: [{ feed: "statpress", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0]).toMatchObject({ type: "MARKETS", subtype: "money and credit (M3)", title: "ECB: Monetary developments in the euro area: September 2026", country: "DE" });
    expect(r.candidates[1].title).toBe("ECB: Account of the monetary policy meeting of 9-10 September 2026");
  });
});
