import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { parseGkg, parseLocations } from "@/data-sources/gdelt-gkg/client";
import { classifyThemes, cleanTitle, decodeEntities, locateArticle, parseGkgArticles } from "@/data-sources/gdelt-gkg/parser";
import { NOW } from "./helpers";

const ctx = { now: NOW, retrievedAt: new Date(NOW).toISOString() };

const row = (o: { url: string; source: string; title: string; themes: string; locs: string; tone?: string }) => {
  const c = new Array(27).fill("");
  c[0] = "20261004114500-1";
  c[1] = "20261004114500";
  c[2] = "1";
  c[3] = o.source;
  c[4] = o.url;
  c[8] = o.themes;
  c[10] = o.locs;
  c[12] = "volodymyr zelensky,10";
  c[15] = o.tone ?? "-5.2,1,6,7,20,0,300";
  c[26] = `<PAGE_TITLE>${o.title}</PAGE_TITLE>`;
  return c.join("\t");
};

const KYIV = "4#Kyiv, Kyyiv, Misto, Ukraine#UP#UP12##50.4333#30.5167#-1044367#120;4#Kyiv, Kyyiv, Misto, Ukraine#UP#UP12##50.4333#30.5167#-1044367#400";
const LONDON = "4#London, London, City of, United Kingdom#UK#UKH9##51.5#-0.1167#-2601889#900";

describe("GKG parsing", () => {
  it("aggregates location mentions", () => {
    const l = parseLocations(KYIV);
    expect(l).toEqual([{ type: 4, name: "Kyiv, Kyyiv, Misto, Ukraine", fips: "UP", lat: 50.4333, lon: 30.5167, mentions: 2 }]);
  });
  it("decodes titles and strips site suffixes", () => {
    expect(decodeEntities("Markets &#xAB;rally&#xBB; &amp; more")).toBe("Markets «rally» & more");
    expect(cleanTitle("Drone strike hits Kyiv power station | Kyiv Independent", "kyivindependent.com")).toBe("Drone strike hits Kyiv power station");
    expect(cleanTitle("Home", "x.com")).toBeNull();
  });
  it("classifies by theme priority with headline evidence, and skips natural hazards", () => {
    expect(classifyThemes(["KILL", "ARMEDCONFLICT", "PROTEST"], "Troops clash with protesters in capital")?.category).toBe("CONFLICT");
    expect(classifyThemes(["ECON_STOCKMARKET"], "Asian stocks rise as yen weakens")?.category).toBe("MARKETS");
    expect(classifyThemes(["NATURAL_DISASTER_FLOOD", "ARMEDCONFLICT"], "Army deployed as floods hit city")).toBeNull();
    expect(classifyThemes(["EDUCATION", "TOURISM"], "Schools reopen after holidays")).toBeNull();
  });
  it("rejects themes the headline doesn't support", () => {
    expect(classifyThemes(["MARITIME_INCIDENT"], "Modern forensic science uncovers human sacrifice in ancient Egypt")).toBeNull();
    expect(classifyThemes(["TAX_DISEASE_CANCER"], "Primary school raises £500 at Macmillan coffee morning")).toBeNull();
    expect(classifyThemes(["MARITIME_INCIDENT", "SCIENCE"], "Researchers discover new deep-sea species")?.category).toBe("SCIENCE");
  });
});

describe("GKG location agreement", () => {
  const [a] = parseGkg(row({ url: "https://kyivindependent.com/a", source: "kyivindependent.com", title: "Drone strike hits Kyiv power station", themes: "ARMEDCONFLICT,1;MILITARY,5", locs: `${KYIV};${LONDON}` }));
  it("uses the geocoded place the headline names", () => {
    expect(locateArticle(a, "Drone strike hits Kyiv power station")).toMatchObject({ precision: "city", lat: 50.4333 });
  });
  it("falls back to a cued headline place, else drops the article", () => {
    expect(locateArticle({ ...a, locations: [] }, "Talks resume in Geneva over Ukraine grain deal")?.name).toMatch(/Geneva|Ukraine/);
    expect(locateArticle({ ...a, locations: parseLocations(LONDON) }, "Officials say talks will continue next week")).toBeNull();
  });
});

describe("GKG → candidates", () => {
  const text = [
    row({ url: "https://kyivindependent.com/a", source: "kyivindependent.com", title: "Drone strike hits Kyiv power station | Kyiv Independent", themes: "ARMEDCONFLICT,1", locs: KYIV }),
    row({ url: "https://reuters.com/b", source: "reuters.com", title: "Drone strike hits power station in Kyiv - Reuters", themes: "ARMEDCONFLICT,1;MILITARY,9", locs: KYIV }),
    row({ url: "https://blog.example/c", source: "blog.example", title: "My favourite recipes for autumn evenings", themes: "TOURISM,1", locs: LONDON }),
    row({ url: "https://ft.com/d", source: "ft.com", title: "London stocks rally as inflation cools", themes: "ECON_STOCKMARKET,1;ECON_INFLATION,40", locs: LONDON }),
  ].join("\n");
  const r = parseGkgArticles({ files: [{ url: "x", articles: parseGkg(text) }] }, ctx);
  it("keeps located, high-signal articles with real headlines", () => {
    expect(r.candidates.map((c) => c.title)).toEqual(
      expect.arrayContaining(["Drone strike hits Kyiv power station", "Drone strike hits power station in Kyiv", "London stocks rally as inflation cools"]),
    );
    expect(r.candidates).toHaveLength(3);
    expect(r.skipped).toBe(1);
    for (const c of r.candidates) {
      expect(EventCandidateSchema.safeParse(c).success).toBe(true);
      expect(c.source.titleIsDerived).toBe(false);
    }
  });
  it("ranks multi-outlet stories first", () => {
    expect(r.candidates[0].type).toBe("CONFLICT");
    expect(r.candidates[0].metrics?.num_articles).toBe(2);
  });
});
