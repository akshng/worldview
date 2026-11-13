import { describe, expect, it } from "vitest";
import { classifyHeadline } from "@/data-sources/news-rss/parser";
import { classifyThemes } from "@/data-sources/gdelt-gkg/parser";
import { conflictSignal } from "@/data-sources/news-classify";
import { HEADLINES, type Label } from "./fixtures/headlines";

const labelOf = (type: string): Label => (type === "CONFLICT" || type === "PROTEST" || type === "DISASTER" ? type : "OTHER");

function score(predict: (title: string) => Label) {
  const out: Record<string, { precision: number; recall: number; fp: string[]; fn: string[] }> = {};
  for (const cat of ["CONFLICT", "PROTEST", "DISASTER"] as const) {
    let tp = 0;
    const fp: string[] = [], fn: string[] = [];
    for (const [title, label] of HEADLINES) {
      const got = predict(title);
      if (got === cat && label === cat) tp++;
      else if (got === cat) fp.push(title);
      else if (label === cat) fn.push(title);
    }
    out[cat] = { precision: tp / Math.max(1, tp + fp.length), recall: tp / Math.max(1, tp + fn.length), fp, fn };
  }
  return out;
}

describe("headline classifier (labelled fixtures)", () => {
  it("has a labelled set of 150–300 headlines", () => {
    expect(HEADLINES.length).toBeGreaterThanOrEqual(150);
    expect(HEADLINES.length).toBeLessThanOrEqual(300);
  });

  const s = score((t) => labelOf(classifyHeadline(t).type));
  // Thresholds are regression guards: raise them when the classifier improves.
  it.each([
    ["CONFLICT", 0.9, 0.85],
    ["PROTEST", 0.9, 0.85],
    ["DISASTER", 0.9, 0.85],
  ] as const)("%s precision ≥ %s and recall ≥ %s", (cat, p, r) => {
    const m = s[cat];
    expect({ cat, precision: m.precision, fp: m.fp }).toEqual(expect.objectContaining({ cat }));
    expect(m.precision, `false positives: ${m.fp.join(" | ")}`).toBeGreaterThanOrEqual(p);
    expect(m.recall, `missed: ${m.fn.join(" | ")}`).toBeGreaterThanOrEqual(r);
  });

  it("files the audited false positives correctly", () => {
    expect(classifyHeadline("Man kills 4-year-old to sell his organs after watching video on making money quickly")).toEqual({ type: "NEWS", subtype: "crime / public safety" });
    expect(classifyHeadline("The war on survival: How Tinubu’s elite economy is suffocating Nigeria’s majority").type).not.toBe("CONFLICT");
    expect(classifyHeadline("Kenya: Ruto Turns Kisii Tour Into Gachagua Attack").type).not.toBe("CONFLICT");
    expect(classifyHeadline("Russia’s trainspotters have spent years documenting the railways. Amid the war, their hobby has put them in the crosshairs").type).not.toBe("CONFLICT");
  });

  it("keeps labour strikes, accidents and crime out of CONFLICT", () => {
    expect(classifyHeadline("Nurses strike over pay in New Zealand")).toEqual({ type: "PROTEST", subtype: "strike" });
    expect(classifyHeadline("Gas explosion at Nairobi depot kills three")).toEqual({ type: "DISASTER", subtype: "accident" });
    expect(conflictSignal("Police hunt gunman after shooting at Sydney nightclub").kind).toBe("crime");
    expect(conflictSignal("Israeli strikes on Lebanon kill five").kind).toBe("conflict");
  });

  it("applies the same context rules to GKG theme classification", () => {
    expect(classifyThemes(["KILL", "ARMEDCONFLICT"], "Man kills 4-year-old to sell his organs after watching video")?.subtype).toBe("crime / public safety");
    expect(classifyThemes(["ARMEDCONFLICT", "ELECTION"], "Trump congratulates Democrats on midterms win, says Iran war played role")?.category).toBe("POLITICS");
    expect(classifyThemes(["ARMEDCONFLICT"], "Russian missile strike on Odesa port damages grain terminal")?.category).toBe("CONFLICT");
    expect(classifyThemes(["MILITARY"], "Musk wages war on advertisers who left X")).toBeNull();
  });
});
