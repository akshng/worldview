import { describe, expect, it } from "vitest";
import { bestIdea, ideasHead, ideasTail, noBestLine } from "@/lib/analyst/ideas-answer";

const d = {
  ideas: [
    { rank: 1, symbol: "DINO", name: "HF Sinclair", industry: "PIPE LINES", suggested_take: "Wait", write_up: "Take: Wait. Reports earnings tomorrow." },
    { rank: 2, symbol: "GWRE", name: "Guidewire", industry: "Prepackaged Software", suggested_take: "Worth a closer look", write_up: "Take: Worth a closer look. Growing +27%." },
    { rank: 3, symbol: "PSX", name: "Phillips 66" },
  ],
  track_record_sentence: "In a backtest … not a reliable edge.",
  concentration_note: null,
};

describe("buy answer assembly", () => {
  it("copies write-ups verbatim and lists unresearched ideas separately", () => {
    const head = ideasHead(d, "S1");
    expect(head).toContain("1. DINO (HF Sinclair, Pipe Lines) [S1]\nTake: Wait. Reports earnings tomorrow.");
    expect(head).toContain("Also flagged, not researched: PSX (Phillips 66).");
  });
  it("picks the first 'Worth a closer look', or says none and what to revisit", () => {
    expect(bestIdea(d)?.symbol).toBe("GWRE");
    expect(noBestLine({ ...d, ideas: d.ideas.slice(0, 1) })).toMatch(/Revisit DINO/);
  });
  it("ends with the track record and watchlist", () => {
    expect(ideasTail(d, [{ symbol: "NVDA", price: 217.94, changePct: 1.2 }])).toBe("Track record: In a backtest … not a reliable edge.\n\nYour watchlist: NVDA $217.94 (+1.20%).");
  });
});
