/**
 * Connector contract. Each data source lives in its own folder:
 *
 *   src/data-sources/<id>/
 *     types.ts   – raw upstream types
 *     client.ts  – fetches raw data (HTTP, auth, caching headers)
 *     parser.ts  – pure: raw → EventCandidate[]  (unit-testable without network)
 *     index.ts   – exports the DataSourceConnector
 *
 * and is registered in src/data-sources/registry.ts. See docs/DATA_SOURCES.md.
 */
import type { EventCandidateInput, EventCategory, SourceType } from "@/types/events";

export interface FetchContext {
  signal: AbortSignal;
  /** Last successful run (ms epoch) — lets connectors fetch incrementally */
  lastSuccessAt: number | null;
  now: number;
  userAgent: string;
  env: Record<string, string | undefined>;
}

export interface ParseContext {
  now: number;
  retrievedAt: string;
}

export interface ParseResult {
  candidates: EventCandidateInput[];
  /** Records intentionally ignored (out of scope, too old, no coordinates, …) */
  skipped: number;
  warnings?: string[];
}

export interface DataSourceConnector<Raw = unknown> {
  id: string;
  name: string;
  description: string;
  homepage: string;
  /** Terms/licence notes worth surfacing to developers */
  attribution: string;
  sourceType: SourceType;
  categories: EventCategory[];
  /** Respect upstream rate limits — never poll faster than this */
  refreshIntervalMs: number;
  /** Request timeout */
  timeoutMs?: number;
  /** "live" connectors ingest real data; "demo" connectors only run in demo mode */
  mode: "live" | "demo";
  /** Whether this connector's own records may be merged together by deduplication */
  mergeWithinSource?: boolean;
  /** Return a reason string if the connector cannot run (e.g. missing key), else null */
  checkConfiguration?(env: Record<string, string | undefined>): string | null;
  fetch(ctx: FetchContext): Promise<Raw>;
  parse(raw: Raw, ctx: ParseContext): ParseResult;
}

export class SourceHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Shared fetch helper with timeout-aware signal, UA header and status checking. */
export async function httpGet(
  url: string,
  ctx: Pick<FetchContext, "signal" | "userAgent">,
  init: { accept?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const res = await fetch(url, {
    signal: ctx.signal,
    headers: { "User-Agent": ctx.userAgent, Accept: init.accept ?? "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const hint =
      res.status === 429 ? "rate limited" : res.status === 401 || res.status === 403 ? "unauthorised — check API key" : res.statusText;
    throw new SourceHttpError(res.status, `HTTP ${res.status} ${hint}`.trim());
  }
  return res;
}

/** Strip HTML tags/entities from upstream text. We never render upstream HTML. */
export function plainText(s: string | null | undefined, max = 2000): string {
  if (!s) return "";
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Accept only http(s) URLs from upstream data. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
