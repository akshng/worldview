/**
 * The analyst loop. Provider-agnostic:
 *   native — hosted model with native tool use (Anthropic): model ⇄ tools until it answers.
 *   agent  — local model, JSON protocol: grammar-constrained planning steps
 *            {"calls":[…]} → run tools → "need more?" → write the answer.
 *   routed — deterministic: keyword/entity routing picks the tools, the model
 *            only writes the summary (the reliable path for a 4B model).
 * Every run is capped at MAX_TOOL_CALLS tool executions; tool output is
 * size-capped before the model sees it; the answer gets the app's source list.
 */
import { capJson } from "./cap";
import { finalizeAnswer, makeCitation } from "./citations";
import type { AnalystLLM, JsonLLM, NativeHistoryItem, NativeLLM } from "./llm";
import { ANALYST_SYSTEM, WRITER_SYSTEM, localSystem, morePrompt, planPrompt, resultBlock, routedPrompt, toolResultsPrompt, writePrompt } from "./prompts";
import { parseStep, stepJsonSchema, type PlannedCall } from "./protocol";
import { MAX_TOOL_CALLS, routeQuestion } from "./router";
import { TOOLS, describeCall, toolCatalog, validateArgs, type ToolDef, type ToolDeps } from "./tools";
import { ANALYST_DISCLAIMER, type AnalystMessage, type AnalystMode, type AnalystStreamEvent, type Citation } from "./types";

export interface AnalystRequest {
  messages: AnalystMessage[];
  watchlist: string[];
  /** "auto": native for hosted models, `localMode` for the local model */
  mode?: "auto" | "agent" | "routed";
  /** Fixed tool plan (desk note); implies routed */
  plan?: PlannedCall[];
}

export interface AnalystEnv {
  llm: AnalystLLM;
  deps: ToolDeps;
  emit: (e: AnalystStreamEvent) => void;
  tools?: ToolDef[];
  maxToolCalls?: number;
  /** Default mode for the local (JSON) model */
  localMode?: "agent" | "routed";
  /** Per-tool timeout */
  toolTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}

export interface AnalystResult {
  text: string;
  citations: Citation[];
  mode: AnalystMode;
  toolCalls: number;
}

const NATIVE_RESULT_CHARS = 12_000;
const LOCAL_RESULT_CHARS = 1_800;
const LOCAL_ROUTED_BUDGET = 13_000;
/** Planning rounds for the local JSON protocol (each may request up to 3 calls) */
const AGENT_ROUNDS = 3;

/** The user explicitly asked for a (new) 10-K analysis */
export const START_ANALYSIS_RE = /\b(analy[sz]e|run|start)\b[^.?!]*\b(10-?k|annual report|filing)/i;

class Aborted extends Error {}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s (data may still be loading)`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Earlier turns, compacted, for context. */
function historyContext(messages: AnalystMessage[]): string {
  const prior = messages.slice(0, -1).slice(-4);
  if (!prior.length) return "";
  return `Earlier in this conversation:\n${prior.map((m) => `${m.role === "user" ? "User" : "Analyst"}: ${m.content.replace(/\n\nSources:[\s\S]*$/, "").slice(0, 600)}`).join("\n")}`;
}

export async function runAnalyst(req: AnalystRequest, env: AnalystEnv): Promise<AnalystResult> {
  const tools = env.tools ?? TOOLS;
  const max = env.maxToolCalls ?? MAX_TOOL_CALLS;
  const now = env.now ?? Date.now;
  const started = now();
  const question = req.messages.at(-1)?.content.trim() ?? "";
  const mode: AnalystMode = req.plan ? "routed" : env.llm.kind === "native" ? (req.mode === "routed" ? "routed" : "native") : req.mode && req.mode !== "auto" ? req.mode : (env.localMode ?? "routed");
  env.emit({ type: "start", provider: env.llm.provider, model: env.llm.model, mode, at: new Date(started).toISOString() });

  const citations: Citation[] = [];
  let executed = 0;
  const checkAbort = () => {
    if (env.signal?.aborted) throw new Aborted("aborted");
  };

  /** Run one tool call (validated), record its citation, return the model-facing block. */
  async function execute(call: { tool: string; args: unknown }, charCap: number): Promise<{ id: string; block: string; ok: boolean }> {
    checkAbort();
    const n = ++executed;
    const def = tools.find((t) => t.name === call.tool);
    const v = def ? validateArgs(def, call.args) : ({ ok: false, error: `unknown tool "${call.tool}"` } as const);
    // Starting a 10-K analysis is a long AI job: only when the user asked for one.
    if (v.ok && call.tool === "annual_report_analysis" && v.args.start && !START_ANALYSIS_RE.test(question)) delete v.args.start;
    const label = v.ok ? describeCall(call.tool, v.args) : `${call.tool}(…)`;
    env.emit({ type: "step", n, tool: call.tool, call: label });
    const t0 = now();
    const fetchedAt = new Date(t0).toISOString();
    if (!def || !v.ok) {
      const err = v.ok ? "unknown tool" : v.error;
      const c = makeCitation(n, call.tool, label, null, fetchedAt, err);
      citations.push(c);
      env.emit({ type: "tool_result", n, tool: call.tool, call: label, ok: false, summary: err, ms: 0, citation: c });
      return { id: c.id, block: resultBlock(c.id, label, null, JSON.stringify({ error: err })), ok: false };
    }
    try {
      const result = await timeout(def.run(v.args, env.deps), env.toolTimeoutMs ?? 45_000);
      const c = makeCitation(n, call.tool, label, result, fetchedAt);
      citations.push(c);
      env.emit({ type: "tool_result", n, tool: call.tool, call: label, ok: true, summary: result.summary, ms: now() - t0, citation: c });
      return { id: c.id, block: resultBlock(c.id, label, result.asOf ?? null, `${capJson({ source: result.source, ...((result.data ?? {}) as object) }, charCap)}`), ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const c = makeCitation(n, call.tool, label, null, fetchedAt, msg.slice(0, 160));
      citations.push(c);
      env.emit({ type: "tool_result", n, tool: call.tool, call: label, ok: false, summary: msg.slice(0, 160), ms: now() - t0, citation: c });
      return { id: c.id, block: resultBlock(c.id, label, null, JSON.stringify({ error: `data unavailable: ${msg.slice(0, 200)}` })), ok: false };
    }
  }

  let text: string;
  if (mode === "native") text = await runNative(env.llm as NativeLLM);
  else if (mode === "agent") text = await runAgent(env.llm as JsonLLM);
  else text = await runRouted(req.plan ?? routeQuestion(question, { watchlist: req.watchlist, findCountry: env.deps.findCountry }));

  const final = finalizeAnswer(text, citations);
  env.emit({ type: "answer", text: final, citations, disclaimer: ANALYST_DISCLAIMER, ms: now() - started, toolCalls: executed });
  return { text: final, citations, mode, toolCalls: executed };

  // ─── Modes ────────────────────────────────────────────────────────────────

  async function runNative(llm: NativeLLM): Promise<string> {
    const history: NativeHistoryItem[] = [];
    for (const m of req.messages.slice(0, -1).slice(-6)) {
      if (m.role === "user") history.push({ role: "user", text: m.content.slice(0, 2000) });
      else history.push({ role: "assistant", turn: { text: m.content.slice(0, 2000), calls: [], stop: "end_turn", raw: [{ type: "text", text: m.content.slice(0, 2000) }] } });
    }
    history.push({ role: "user", text: req.watchlist.length ? `${question}\n\n(My watchlist: ${req.watchlist.join(", ")})` : question });
    for (let turnNo = 0; turnNo < max + 2; turnNo++) {
      checkAbort();
      const allowTools = executed < max;
      const turn = await llm.turn({ system: ANALYST_SYSTEM, history, tools, allowTools });
      if (turn.stop === "refusal") return turn.text || "The model declined to answer this question.";
      if (!turn.calls.length || !allowTools) return turn.text;
      history.push({ role: "assistant", turn });
      const results: Array<{ id: string; content: string; isError: boolean }> = [];
      for (const call of turn.calls) {
        if (executed >= max) {
          results.push({ id: call.id, content: `Not run: the tool budget (${max} calls) is used up. Answer with the data you have.`, isError: true });
          continue;
        }
        const r = await execute({ tool: call.name, args: call.input }, NATIVE_RESULT_CHARS);
        results.push({ id: call.id, content: r.block, isError: !r.ok });
      }
      history.push({ role: "tool_results", results });
    }
    // Out of turns: one last answer with tools disabled.
    const last = await llm.turn({ system: ANALYST_SYSTEM, history, tools, allowTools: false });
    return last.text;
  }

  async function runAgent(llm: JsonLLM): Promise<string> {
    const schema = stepJsonSchema(tools);
    return llm.session(localSystem(toolCatalog(tools)), async (s) => {
      env.emit({ type: "status", text: "Planning which data to pull…" });
      let prompt = planPrompt(req.watchlist.length ? `${question} (My watchlist: ${req.watchlist.join(", ")})` : question, historyContext(req.messages), max);
      /** Tool results the model hasn't seen yet */
      let pending = "";
      for (let round = 0; round < AGENT_ROUNDS; round++) {
        checkAbort();
        const raw = await s.json(prompt, schema, 400);
        const step = parseStep(raw, tools);
        let calls = step.calls.slice(0, max - executed);
        if (!calls.length && round === 0) {
          // The model wanted to answer without data: fall back to routing.
          env.emit({ type: "status", text: "Model chose no tools; routing by keywords." });
          calls = routeQuestion(question, { watchlist: req.watchlist, findCountry: env.deps.findCountry }).slice(0, max - executed);
        }
        if (!calls.length) break;
        const blocks: string[] = [];
        for (const c of calls) blocks.push((await execute(c, LOCAL_RESULT_CHARS)).block);
        pending = toolResultsPrompt(blocks);
        if (executed >= max || round === AGENT_ROUNDS - 1) break;
        prompt = `${pending}\n\n${morePrompt(max - executed)}`;
        pending = "";
      }
      return write(s, `${pending ? `${pending}\n\n` : ""}${writePrompt(question)}`);
    });
  }

  async function write(s: { text: (p: string, n: number, d?: (c: string) => void) => Promise<string> }, prompt: string) {
    checkAbort();
    env.emit({ type: "status", text: "Writing the answer…" });
    return s.text(prompt, 900, (chunk) => env.emit({ type: "answer_delta", text: chunk }));
  }

  async function runRouted(plan: PlannedCall[]): Promise<string> {
    const calls = plan.slice(0, max);
    const cap = env.llm.kind === "native" ? NATIVE_RESULT_CHARS : Math.min(2_600, Math.floor(LOCAL_ROUTED_BUDGET / Math.max(1, calls.length)));
    // Stock ideas ARE the answer to a buy question: give them room so nothing is cut mid-sentence.
    const capFor = (tool: string) => (tool === "stock_ideas" && env.llm.kind !== "native" ? Math.max(cap, 5_000) : cap);
    const blocks: string[] = [];
    for (const c of calls) blocks.push((await execute(c, capFor(c.tool))).block);
    checkAbort();
    const prompt = routedPrompt(req.watchlist.length ? `${question} (My watchlist: ${req.watchlist.join(", ")})` : question, historyContext(req.messages), blocks);
    if (env.llm.kind === "native") {
      const turn = await env.llm.turn({ system: WRITER_SYSTEM, history: [{ role: "user", text: prompt }], tools, allowTools: false });
      return turn.text;
    }
    return env.llm.session(WRITER_SYSTEM, (s) => write(s, prompt));
  }
}

export { Aborted as AnalystAborted };
