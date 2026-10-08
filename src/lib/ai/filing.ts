/**
 * Map-reduce driver for 10-K analysis, shared by every provider. Long sections
 * are split into chunks, each chunk is condensed to notes ("map"), notes are
 * merged until they fit a per-section budget ("reduce"), and one final
 * structured call writes the analysis from the computed figures + notes.
 * Providers only supply a plain completion and a structured completion.
 */
import { FILING_CONDENSE_SYSTEM, FILING_SECTION_TITLES, FILING_SYSTEM, filingChunkSystem, filingPayload, type FilingSectionKey } from "./prompts";
import type { FilingAnalysisInput, FilingSections } from "./types";

export interface FilingRunner {
  /** Plain-text completion */
  complete(system: string, user: string, maxTokens: number): Promise<string>;
  /** Final structured completion */
  structured(system: string, user: string): Promise<FilingSections>;
  /** Max characters of filing text per map call */
  chunkChars: number;
  /** Max characters of notes per section going into the final call */
  sectionBudget: Record<FilingSectionKey, number>;
  /** Hard cap of filing text read per section (keeps runtime bounded) */
  maxSectionChars: number;
}

const ORDER: FilingSectionKey[] = ["business", "riskFactors", "mdna", "marketRisk"];
const LABEL: Record<FilingSectionKey, string> = { business: "the business description", riskFactors: "risk factors", mdna: "MD&A", marketRisk: "market risk" };

/**
 * Split text into chunks of at most `max` characters, preferring paragraph,
 * then line, then sentence, then word boundaries. Pure.
 */
export function chunkText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.5) cut = window.lastIndexOf("\n");
    if (cut < max * 0.5) cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; ")) + 1;
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const cleanNotes = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/no substantive content/i.test(l))
    .join("\n");

/** Reduce one section to at most its budget of notes (verbatim if it already fits). */
async function condenseSection(r: FilingRunner, key: FilingSectionKey, text: string, progress: (s: string) => void): Promise<string> {
  const capped = text.length > r.maxSectionChars ? text.slice(0, r.maxSectionChars) : text;
  const budget = r.sectionBudget[key];
  if (capped.length <= budget) return capped;
  const chunks = chunkText(capped, r.chunkChars);
  const notes: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    progress(`Summarizing ${LABEL[key]}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}…`);
    notes.push(cleanNotes(await r.complete(filingChunkSystem(key), `Excerpt from ${FILING_SECTION_TITLES[key]}:\n\n${chunks[i]}`, 500)));
  }
  let merged = notes.filter(Boolean).join("\n");
  for (let round = 0; merged.length > budget && round < 3; round++) {
    const groups = chunkText(merged, r.chunkChars);
    const next: string[] = [];
    for (let i = 0; i < groups.length; i++) {
      progress(`Combining ${LABEL[key]} notes${groups.length > 1 ? ` (${i + 1}/${groups.length})` : ""}…`);
      next.push(cleanNotes(await r.complete(FILING_CONDENSE_SYSTEM, groups[i], 600)));
    }
    merged = next.join("\n");
  }
  return merged.slice(0, budget);
}

const tidy = (xs: string[], max: number) =>
  xs
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((x) => x.slice(0, 600));

export async function runFilingAnalysis(r: FilingRunner, input: FilingAnalysisInput): Promise<FilingSections> {
  const progress = input.onProgress ?? (() => undefined);
  const notes: Partial<Record<FilingSectionKey, string>> = {};
  for (const key of ORDER) {
    const t = input.text?.[key];
    if (t?.trim()) notes[key] = await condenseSection(r, key, t, progress);
  }
  progress("Writing the analysis…");
  const out = await r.structured(FILING_SYSTEM, filingPayload(input, notes));
  if (!out.keyFinancialChanges.some((x) => x.trim()) && !out.investorQuestions.some((x) => x.trim())) throw new Error("The AI model returned an empty analysis.");
  // Text-derived sections stay empty when the filing text wasn't read, so the
  // model can't fill them from memory.
  return {
    businessSummary: notes.business ? out.businessSummary.trim().slice(0, 1500) : "",
    keyFinancialChanges: tidy(out.keyFinancialChanges, 8),
    topRisks: notes.riskFactors ? tidy(out.topRisks, 6) : [],
    outlook: notes.mdna || notes.marketRisk ? tidy(out.outlook, 6) : [],
    notableChanges: tidy(out.notableChanges, 6),
    investorQuestions: tidy(out.investorQuestions, 6),
  };
}
