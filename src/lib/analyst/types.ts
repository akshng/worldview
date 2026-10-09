/** AI analyst: types shared by the server loop, the API stream and the chat panel (client-safe). */

export const ANALYST_DISCLAIMER = "Information only, not investment advice.";

/** A chat turn as the client sends it (prior answers are plain text). */
export interface AnalystMessage {
  role: "user" | "assistant";
  content: string;
}

/** An in-app action a citation can offer. */
export type CitationAction =
  | { kind: "instrument"; symbol: string; label: string }
  | { kind: "event"; id: string; lat: number; lon: number; label: string }
  | { kind: "country"; code: string; label: string };

/** One tool call the answer was built from. `id` ("S1") is what the model cites. */
export interface Citation {
  id: string;
  tool: string;
  /** Human-readable call, e.g. get_quote(NVDA, AMD) */
  call: string;
  /** Upstream data source(s) as the app labels them */
  source: string;
  /** When the data was observed upstream (latest timestamp in the result), if known */
  asOf: string | null;
  /** When the tool ran */
  fetchedAt: string;
  ok: boolean;
  /** Outbound links (filings, sources) */
  links: Array<{ label: string; url: string }>;
  actions: CitationAction[];
}

/** How the run picked its tools. */
export type AnalystMode = "native" | "agent" | "routed";

/** Lines of the NDJSON stream from /api/analyst/chat and /api/analyst/desk-note. */
export type AnalystStreamEvent =
  | { type: "start"; provider: string; model: string; mode: AnalystMode; at: string }
  | { type: "status"; text: string }
  | { type: "step"; n: number; tool: string; call: string }
  | { type: "tool_result"; n: number; tool: string; call: string; ok: boolean; summary: string; ms: number; citation: Citation }
  | { type: "answer_delta"; text: string }
  | { type: "answer"; text: string; citations: Citation[]; disclaimer: string; ms: number; toolCalls: number }
  | { type: "error"; message: string };
