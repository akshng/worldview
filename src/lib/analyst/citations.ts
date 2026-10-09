/**
 * Citations: every tool call becomes a numbered source ([S1], [S2]…) with its
 * data source and timestamps. The model cites markers inline; the app appends
 * the source list itself, so an answer always says what it was built from.
 * Pure and tested.
 */
import { ANALYST_DISCLAIMER, type Citation } from "./types";
import type { ToolResult } from "./tools";

export function makeCitation(n: number, tool: string, call: string, result: ToolResult | null, fetchedAt: string, error?: string): Citation {
  return {
    id: `S${n}`,
    tool,
    call,
    source: result?.source ?? (error ? `unavailable: ${error}` : "unavailable"),
    // Some feeds stamp the in-progress interval's end (in the future): cap at fetch time.
    asOf: result?.asOf && Date.parse(result.asOf) > Date.parse(fetchedAt) + 60_000 ? fetchedAt : (result?.asOf ?? null),
    fetchedAt,
    ok: !!result,
    links: result?.links?.slice(0, 6) ?? [],
    actions: result?.actions?.slice(0, 6) ?? [],
  };
}

/** "2026-10-08 14:30 UTC" (or the date alone for date-only values). */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "time n/a";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Marker ids cited in the text, in order of first use: ["S2", "S1"]. */
export function citedIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)) for (const id of m[1].split(/\s*,\s*/)) if (!out.includes(id)) out.push(id);
  return out;
}

/** One source line: "[S1] get_quote(NVDA) — Yahoo Finance (delayed); data as of …, fetched …". */
export function formatCitation(c: Citation): string {
  if (!c.ok) return `[${c.id}] ${c.call} — failed (${c.source.replace(/^unavailable: /, "")})`;
  const asOf = c.asOf ? `data as of ${formatTimestamp(c.asOf)}, ` : "";
  return `[${c.id}] ${c.call} — ${c.source}; ${asOf}fetched ${formatTimestamp(c.fetchedAt)}`;
}

/**
 * Final answer text: drops markers that don't match a source and any source
 * list the model wrote itself, then appends the app's source list and the
 * disclaimer.
 */
export function finalizeAnswer(text: string, citations: Citation[]): string {
  const valid = new Set(citations.map((c) => c.id));
  let body = text
    .replace(/<\/?think>/g, "")
    .replace(/\n+(#+\s*)?(\*\*)?(sources|references)( used)?:?(\*\*)?\s*\n[\s\S]*$/i, "")
    .replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_m, ids: string) => {
      const keep = ids.split(/\s*,\s*/).filter((id) => valid.has(id));
      return keep.length ? `[${keep.join(", ")}]` : "";
    })
    .replace(new RegExp(`\\n*_?\\*?${ANALYST_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*?_?\\s*$`, "i"), "")
    .trim();
  if (!body) body = "No answer was produced.";
  const sources = citations.length ? `\n\nSources:\n${citations.map(formatCitation).join("\n")}` : "\n\nSources: none (no tool data was used).";
  return `${body}${sources}\n\n${ANALYST_DISCLAIMER}`;
}
