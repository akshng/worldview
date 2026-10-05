/** In-process cache so the AI briefing narrative is generated at most once per period. */
import type { DailyBriefing } from "./index";

type Narrative = NonNullable<DailyBriefing["aiNarrative"]>;
const MAX_AGE_MS = 3 * 3_600_000;

const g = globalThis as unknown as { __worldviewNarrative?: Narrative | null };

export function cachedNarrative(now = Date.now()): Narrative | null {
  const n = g.__worldviewNarrative;
  return n && now - Date.parse(n.generatedAt) < MAX_AGE_MS ? n : null;
}

export function storeNarrative(n: Narrative) {
  g.__worldviewNarrative = n;
}
