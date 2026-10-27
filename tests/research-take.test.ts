import { describe, expect, it } from "vitest";
import { suggestTake } from "@/lib/finance/research-take";
import { searchName } from "@/lib/finance/stock-research";

const base = { headlines: [] as string[], earningsRecent: null, earningsUpcoming: null, growth: null, insiderBuyers: 0, insiderBuyValue: 0 };

describe("research take", () => {
  it("waits for an earnings report that's days away", () => {
    expect(suggestTake({ ...base, growth: 30, earningsUpcoming: "Reports earnings on 2026-10-29 (before open)." }).take).toBe("Wait");
  });
  it("passes on company-specific bad news without growth", () => {
    const t = suggestTake({ ...base, headlines: ["Acme cuts guidance after weak quarter"], growth: -2 });
    expect(t.take).toBe("Pass");
    expect(t.likelyCause).toMatch(/Company-specific bad news/);
  });
  it("likes a growing business hit by an industry-wide drop", () => {
    const t = suggestTake({ ...base, headlines: ["Refiners slide as crude jumps"], growth: 53 });
    expect(t.take).toBe("Worth a closer look");
    expect(t.reason).toMatch(/industry-wide/);
  });
  it("waits when nothing explains the drop", () => {
    expect(suggestTake({ ...base, growth: 10 }).take).toBe("Wait");
  });
  it("cleans SEC names for news search", () => {
    expect(searchName("VALERO ENERGY CORP/TX")).toBe("Valero Energy");
    expect(searchName("Coca-Cola Company (The)")).toBe("Coca-Cola");
    expect(searchName("HF Sinclair Corp")).toBe("HF Sinclair");
  });
});
