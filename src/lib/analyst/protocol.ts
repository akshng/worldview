/**
 * JSON tool-calling protocol for the local model. Each planning step the model
 * emits (grammar-constrained) `{"calls":[{"tool":"get_quote","args":{...}}]}`;
 * an empty list means "I have enough, answer now". The parser is tolerant of
 * code fences, prose around the JSON and a few common shape variants, and
 * validates every call against the tool registry. Pure and tested.
 */
import { TOOLS, toolByName, validateArgs, type ParamSpec, type ToolDef } from "./tools";

export interface PlannedCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ParsedStep {
  calls: PlannedCall[];
  /** Calls that were rejected (unknown tool / bad args), for the trace */
  errors: string[];
  /** The model asked to answer (no calls) */
  answer: boolean;
}

export const MAX_CALLS_PER_STEP = 3;

/** First balanced top-level JSON object in `text`, or null. */
export function extractJson(text: string): unknown {
  const s = text.replace(/```(?:json)?/gi, "");
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

function rawCalls(obj: unknown): unknown[] | "answer" {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Record<string, unknown>;
  if (o.action === "answer" || o.tool === "answer") return "answer";
  if (Array.isArray(o.calls)) return o.calls;
  if (Array.isArray(o.tool_calls)) return o.tool_calls;
  if (typeof o.tool === "string" || typeof o.name === "string") return [o];
  return [];
}

/** Parse one planning step. */
export function parseStep(text: string, defs: ToolDef[] = TOOLS): ParsedStep {
  const obj = extractJson(text);
  if (obj === null) return { calls: [], errors: ["no JSON object in model output"], answer: true };
  const raw = rawCalls(obj);
  if (raw === "answer") return { calls: [], errors: [], answer: true };
  const calls: PlannedCall[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const name = String(r.tool ?? r.name ?? "");
    const def = defs.find((d) => d.name === name) ?? (defs === TOOLS ? toolByName(name) : undefined);
    if (!def) {
      errors.push(`unknown tool "${name}"`);
      continue;
    }
    const v = validateArgs(def, r.args ?? r.arguments ?? r.input ?? {});
    if (!v.ok) {
      errors.push(v.error);
      continue;
    }
    const key = `${name}:${JSON.stringify(v.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ tool: name, args: v.args });
    if (calls.length >= MAX_CALLS_PER_STEP) break;
  }
  return { calls, errors, answer: calls.length === 0 && errors.length === 0 };
}

// ─── Grammar (JSON schema for node-llama-cpp) ───────────────────────────────

function gbnfParam(p: ParamSpec): Record<string, unknown> {
  const base =
    p.type === "string[]"
      ? { type: "array", items: { type: "string" }, maxItems: 10 }
      : p.enum
        ? { enum: [...p.enum] }
        : { type: p.type };
  return p.required ? base : { oneOf: [base, { type: "null" }] };
}

/** JSON schema the local model's planning output is constrained to. */
export function stepJsonSchema(defs: ToolDef[] = TOOLS) {
  return {
    type: "object",
    properties: {
      calls: {
        type: "array",
        maxItems: MAX_CALLS_PER_STEP,
        items: {
          oneOf: defs.map((d) => ({
            type: "object",
            properties: {
              tool: { const: d.name },
              args: { type: "object", properties: Object.fromEntries(Object.entries(d.params).map(([k, p]) => [k, gbnfParam(p)])) },
            },
          })),
        },
      },
    },
  } as const;
}
