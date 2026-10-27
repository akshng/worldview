/**
 * The answer to "what should I buy?" is assembled from the researched stock ideas
 * (verbatim write-ups, the cluster note, the track record), so a small local model
 * can't garble it. The model writes only the "best of the bunch" comparison.
 */

export interface IdeaRow {
  rank: number;
  symbol: string;
  name: string;
  industry?: string | null;
  suggested_take?: string;
  write_up?: string;
}
export interface IdeasData {
  ideas: IdeaRow[];
  track_record_sentence?: string;
  concentration_note?: string | null;
}
export interface QuoteRow {
  symbol: string;
  price: number | null;
  changePct: number | null;
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const label = (i: IdeaRow) => `${i.symbol} (${i.name}${i.industry ? `, ${title(i.industry)}` : ""})`;

export function bestIdea(d: IdeasData): IdeaRow | null {
  return d.ideas.find((i) => i.write_up && i.suggested_take === "Worth a closer look") ?? null;
}

export function ideasHead(d: IdeasData, marker: string): string {
  const researched = d.ideas.filter((i) => i.write_up);
  const rest = d.ideas.filter((i) => !i.write_up);
  if (!d.ideas.length) return "The screen found nothing worth flagging today.";
  return [
    "Top ideas (researched):",
    ...researched.map((i, n) => `${n + 1}. ${label(i)} [${marker}]\n${i.write_up}`),
    ...(rest.length ? [`\nAlso flagged, not researched: ${rest.map(label).join("; ")}.`] : []),
  ].join("\n\n");
}

/** What to say when nothing earned "Worth a closer look". */
export function noBestLine(d: IdeasData): string {
  const waiting = d.ideas.filter((i) => i.suggested_take === "Wait");
  return waiting.length
    ? `None yet. Revisit ${waiting.map((i) => i.symbol).join(" and ")} once the open questions above are answered (earnings, or the cause of the drop).`
    : "None of today's ideas holds up after the research.";
}

export function ideasTail(d: IdeasData, quotes: QuoteRow[]): string {
  const q = quotes
    .filter((x) => x.price !== null)
    .map((x) => `${x.symbol} $${x.price!.toLocaleString("en-US", { maximumFractionDigits: 2 })}${x.changePct !== null ? ` (${x.changePct > 0 ? "+" : ""}${x.changePct.toFixed(2)}%)` : ""}`);
  return [d.concentration_note ?? null, d.track_record_sentence ? `Track record: ${d.track_record_sentence}` : null, q.length ? `Your watchlist: ${q.join(", ")}.` : null]
    .filter(Boolean)
    .join("\n\n");
}

export function bestPrompt(d: IdeasData, best: IdeaRow): string {
  const others = d.ideas.filter((i) => i.write_up && i.symbol !== best.symbol);
  return `Researched stock ideas:\n\n${d.ideas
    .filter((i) => i.write_up)
    .map((i) => `${label(i)}\n${i.write_up}`)
    .join("\n\n")}\n\nThe strongest candidate is ${best.symbol}. In two sentences, explain why ${best.symbol} looks stronger than ${others.map((o) => o.symbol).join(" and ") || "the rest"}, using only the facts above. No price targets, no predictions, no advice on how much to buy. Reply with the two sentences only.`;
}
