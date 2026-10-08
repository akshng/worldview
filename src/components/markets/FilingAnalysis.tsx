"use client";
/**
 * 10-K analysis card: computed XBRL figures (facts) kept visibly separate from
 * the AI-written sections (interpretation). Information only.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { AnnualReport } from "@/lib/finance/company";
import { formatFactChange, formatFactValue, type FilingJobStatus } from "@/lib/finance/filing-format";
import { relativeTime } from "@/lib/time";
import { CloseIcon, ExternalIcon, SparkIcon } from "@/components/ui/icons";
import { SafeLink } from "@/components/ui/primitives";

export function FilingAnalysisModal({ ticker, report, onClose }: { ticker: string; report: AnnualReport; onClose: () => void }) {
  const [job, setJob] = useState<FilingJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (start: boolean) => {
      try {
        let s = await api.filingAnalysisStatus(report.accession);
        if (start && (s.status === "none" || s.status === "error")) s = await api.startFilingAnalysis(ticker, report.accession);
        if (stop) return;
        setJob(s);
        if (s.status === "running") timer = setTimeout(() => void poll(false), 1500);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // keep the instrument view open
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ticker, report.accession, onClose]);

  const r = job?.result ?? null;
  const ai = r?.sections ?? null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-center overflow-y-auto bg-black/60 py-10"
      onMouseDown={(e) => {
        e.stopPropagation(); // don't also close the instrument view underneath
        onClose();
      }}
    >
      <div className="glass h-fit w-[760px] rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={`${ticker} ${report.form} analysis`}>
        <div className="flex items-start justify-between border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-faint">{ticker} · {report.form} · filed {report.filed}</div>
            <h2 className="mt-1 text-[18px] font-semibold">
              {r?.company ?? ticker} — {report.period ? `fiscal year ended ${report.period}` : "annual report"}
            </h2>
            <div className="mt-1 flex gap-3 text-[11.5px]">
              <SafeLink href={report.url} className="flex items-center gap-1 text-accent hover:underline">Filing <ExternalIcon width={10} height={10} /></SafeLink>
              <SafeLink href={report.indexUrl} className="flex items-center gap-1 text-accent hover:underline">Filing index <ExternalIcon width={10} height={10} /></SafeLink>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
          {job?.status === "error" && <p className="text-[12.5px] text-danger">{job.error}</p>}
          {job?.status === "running" && (
            <div className="rounded border border-line px-3 py-2.5 text-[12.5px]">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                <span>{job.step ?? "Working…"}</span>
              </div>
              {job.steps.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-4 text-[11.5px] text-faint">
                  {job.steps.slice(-5).map((s, i) => <li key={i}>✓ {s.replace(/…$/, "")}</li>)}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-faint">The on-device model reads long filings in pieces; this can take several minutes. The result is saved, so each filing is analysed once.</p>
            </div>
          )}
          {!job && !error && <div className="h-24 animate-pulse rounded bg-white/[0.03]" />}

          {r && (
            <>
              {r.notices.map((n) => (
                <p key={n} className="rounded border border-warn/30 px-3 py-2 text-[12px] text-warn">{n}</p>
              ))}

              <section>
                <h3 className="meta mb-1.5 text-faint">Reported figures (XBRL, computed by WorldView)</h3>
                {r.facts.lines.length ? (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="meta text-faint">
                        <th className="pb-1 text-left font-normal"> </th>
                        <th className="pb-1 text-right font-normal">FY to {r.facts.periodEnd ?? "—"}</th>
                        <th className="pb-1 text-right font-normal">FY to {r.facts.priorPeriodEnd ?? "—"}</th>
                        <th className="pb-1 text-right font-normal">Change</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {r.facts.lines.map((l) => (
                        <tr key={l.key} className="border-t border-line" title={`Source: ${l.source}`}>
                          <td className="py-1">{l.label}</td>
                          <td className="text-right">{formatFactValue(l.current, l.unit)}</td>
                          <td className="text-right text-muted">{formatFactValue(l.prior, l.unit)}</td>
                          <td className="text-right text-muted">
                            {l.change !== null && l.change !== 0 ? (l.change > 0 ? "▲ " : "▼ ") : ""}
                            {formatFactChange(l)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[12px] text-faint">No XBRL financial data was reported for this filing.</p>
                )}
                <p className="mt-1 text-[10.5px] text-faint">
                  From SEC XBRL company facts as reported in this filing (prior year = the filing&apos;s comparatives). Hover a row for its tag or formula.
                  {r.facts.missing.length > 0 && ` Not reported: ${r.facts.missing.join(", ")}.`}
                </p>
              </section>

              {ai ? (
                <section className="rounded-md border border-ai/25 bg-ai-soft px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="meta flex items-center gap-1.5 text-ai"><SparkIcon width={12} height={12} /> AI analysis</h3>
                    <span className="meta text-ai/60">Interpretation — not verified fact</span>
                  </div>
                  {ai.businessSummary && <AISection title="Business summary"><p>{ai.businessSummary}</p></AISection>}
                  <AIList title="Key financial changes" items={ai.keyFinancialChanges} />
                  <AIList title="Top risks" items={ai.topRisks} />
                  <AIList title="Management's outlook / MD&A highlights" items={ai.outlook} />
                  <AIList title="Notable changes vs prior year" items={ai.notableChanges} />
                  <AIList title="Questions an investor might ask" items={ai.investorQuestions} />
                  <div className="meta mt-2 normal-case tracking-normal text-faint">
                    {r.provider} · {r.model} · {relativeTime(r.generatedAt)} — written only from the figures above
                    {r.mode === "full" ? " and the filing's own text" : ""}
                  </div>
                  {r.sectionsRead.length > 0 && (
                    <div className="mt-1 text-[11px] text-faint">
                      Sections read:{" "}
                      {r.sectionsRead.map((s, i) => (
                        <span key={s.id}>
                          {i > 0 && " · "}
                          <SafeLink href={r.filingUrl} className="hover:text-accent">{s.title}</SafeLink> ({Math.round(s.chars / 1000)}k chars)
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
        <p className="border-t border-line px-6 py-2.5 text-[10.5px] text-faint">{r?.disclaimer ?? "Information only — not investment advice."}</p>
      </div>
    </div>
  );
}

function AISection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 text-[12.5px] leading-relaxed text-fg/85">
      <h4 className="meta mb-0.5 text-ai/80">{title}</h4>
      {children}
    </div>
  );
}

function AIList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <AISection title={title}>
      <ul className="list-disc space-y-0.5 pl-4 marker:text-ai/50">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </AISection>
  );
}
