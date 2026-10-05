/**
 * AI integration logic with a mock interpreter (no network). Verifies the app
 * never lets AI output become facts: places are resolved by the gazetteer,
 * categories are schema-validated, results are real stored events.
 */
import { describe, expect, it } from "vitest";
import { CommandIntentSchema, type CommandIntent } from "@/lib/ai/types";
import { search } from "@/lib/search";
import { MemoryEventRepository } from "@/lib/db/memory-repository";
import { ingestCandidates } from "@/lib/ingestion/pipeline";
import { cachedNarrative, storeNarrative } from "@/lib/briefing/narrative-cache";
import { candidate, NOW, source } from "./helpers";

async function seeded() {
  const repo = new MemoryEventRepository(null);
  const now = Date.now();
  await ingestCandidates(
    repo,
    [
      candidate({ timestamp: new Date(now - 3_600_000).toISOString(), metrics: { magnitude: 6.1 } }), // Japan
      candidate({ latitude: -33.4, longitude: -70.6, title: "M 4.2 earthquake — Chile", timestamp: new Date(now - 7_200_000).toISOString(), metrics: { magnitude: 4.2 }, source: source({ id: "usgs:cl", externalId: "cl" }) }),
    ],
    { mergeWithinSource: new Set(), now },
  );
  return repo;
}

const intent = (o: Partial<CommandIntent>): CommandIntent => ({
  categories: [],
  range: null,
  minMagnitude: null,
  place: null,
  keywords: null,
  explanation: "test",
  ...o,
});

describe("AI command interpretation", () => {
  it("validates the model's structured output", () => {
    expect(CommandIntentSchema.safeParse(intent({ categories: ["EARTHQUAKE"] })).success).toBe(true);
    expect(CommandIntentSchema.safeParse({ ...intent({}), categories: ["UFO"] }).success).toBe(false);
    expect(CommandIntentSchema.safeParse({ ...intent({}), range: "3w" }).success).toBe(false);
  });

  it("applies AI filters to real stored events and resolves places with the gazetteer", async () => {
    const repo = await seeded();
    const r = await search(repo, "why is there so much activity around japan?", {
      interpret: async () => intent({ categories: ["EARTHQUAKE"], place: "Japan", explanation: "Earthquakes in Japan" }),
    });
    expect(r.intent?.source).toBe("ai");
    expect(r.intent?.place).toMatchObject({ name: "Japan", country: "JP" });
    expect(r.events.map((e) => e.country)).toEqual(["JP"]);
  });

  it("ignores places the gazetteer cannot resolve instead of inventing coordinates", async () => {
    const repo = await seeded();
    const r = await search(repo, "what happened in atlantis", { interpret: async () => intent({ place: "Atlantis", categories: ["EARTHQUAKE"] }) });
    expect(r.intent?.place).toBeNull();
    expect(r.events.length).toBe(2); // falls back to category filter only
  });

  it("supports magnitude thresholds from AI", async () => {
    const repo = await seeded();
    const r = await search(repo, "big quakes", { interpret: async () => intent({ categories: ["EARTHQUAKE"], minMagnitude: 5 }) });
    expect(r.events.map((e) => e.metrics.magnitude)).toEqual([6.1]);
  });
});

describe("briefing narrative cache", () => {
  it("serves a recent narrative and expires old ones", () => {
    storeNarrative({ text: "x", provider: "mock", model: "m", generatedAt: new Date(NOW).toISOString() });
    expect(cachedNarrative(NOW + 60_000)?.text).toBe("x");
    expect(cachedNarrative(NOW + 4 * 3_600_000)).toBeNull();
  });
});
