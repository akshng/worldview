"use client";
/** Security: CISA known-exploited vulnerabilities, new critical CVEs (NVD) and travel-advisory changes. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { SecurityDashboard } from "@/lib/cyber";
import { useUI } from "@/lib/store/ui";
import { relativeTime } from "@/lib/time";
import { CloseIcon } from "@/components/ui/icons";

const GOV_NAME: Record<string, string> = {
  US: "U.S. State Dept",
  UK: "UK FCDO",
  CA: "Canada",
  AU: "Smartraveller",
};

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {note && <span className="text-[10.5px] text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Link = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href ? (
    <a className="hover:text-accent" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );

export function SecurityPanel() {
  const open = useUI((s) => s.securityOpen);
  const setOpen = useUI((s) => s.setSecurityOpen);
  const [data, setData] = useState<SecurityDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api
      .cyber(ctrl.signal)
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setErr(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const kev = data?.kev;
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 px-4 py-8" onMouseDown={() => setOpen(false)}>
      <div
        className="glass h-fit w-[860px] max-w-full rounded-lg shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Security"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-accent">Security</div>
            <h2 className="mt-1 text-[20px] leading-tight font-semibold tracking-tight">Vulnerabilities &amp; travel advisories</h2>
            <p className="mt-1 text-[12px] text-muted">
              Official sources only: CISA, NIST NVD and the U.S., UK, Canadian and Australian governments.
              {data && ` Updated ${relativeTime(data.generatedAt)}.`}
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" title="Close (Esc)" aria-label="Close security panel">
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-5 px-6 py-5">
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {!data && !err && <p className="text-[12px] text-muted">Loading… (first load gathers several government feeds and can take a few seconds)</p>}

          {kev && (
            <Section
              title="Newly exploited (CISA KEV)"
              note={`${kev.addedLast7d} added in 7 days · ${kev.addedLast30d} in 30 days · ${kev.total.toLocaleString("en-US")} in catalog`}
            >
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] text-faint">
                    <th className="py-1 font-normal">CVE</th>
                    <th className="py-1 font-normal">Vendor · product</th>
                    <th className="py-1 font-normal">Added</th>
                    <th className="py-1 font-normal" title="Remediation deadline for U.S. federal civilian agencies">
                      Due
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {kev.latest.slice(0, 15).map((v) => (
                    <tr key={v.cveId} className="border-t border-line align-top" title={v.description}>
                      <td className="tabular py-1 pr-2 whitespace-nowrap">
                        <Link href={v.url}>{v.cveId}</Link>
                        {v.ransomware && (
                          <span className="ml-1.5 rounded bg-danger/15 px-1 text-[10px] text-danger" title="CISA: known use in ransomware campaigns">
                            ransomware
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <span className="text-fg">{v.vendor}</span> <span className="text-muted">{v.product}</span>
                      </td>
                      <td className="tabular py-1 pr-2 whitespace-nowrap text-muted">{v.dateAdded}</td>
                      <td className="tabular py-1 whitespace-nowrap text-muted">{v.dueDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {data && (
            <Section title="New critical CVEs" note={`NVD · CVSS v3 critical · published in the last ${data.cveWindowDays} days · ${data.cves.length}`}>
              {data.cves.length === 0 ? (
                <p className="text-[12px] text-muted">{data.failed.includes("NVD") ? "NVD is unavailable right now." : "None published in this window."}</p>
              ) : (
                <ul className="divide-y divide-line text-[12px]">
                  {data.cves.slice(0, 20).map((c) => (
                    <li key={c.id} className="py-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="tabular whitespace-nowrap">
                          <Link href={c.url}>{c.id}</Link>
                        </span>
                        <span className="tabular rounded bg-danger/15 px-1 text-[10.5px] text-danger" title={c.vector ?? undefined}>
                          {c.score.toFixed(1)}
                        </span>
                        {c.knownExploited && <span className="rounded bg-warn/15 px-1 text-[10px] text-warn">in KEV</span>}
                        <span className="truncate text-muted">{[c.vendor, c.product].filter(Boolean).join(" · ")}</span>
                        <span className="tabular ml-auto whitespace-nowrap text-[11px] text-faint">{c.published.slice(0, 10)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{c.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {data && (
            <Section title="Latest travel-advisory changes" note="Updated in the last 30 days at elevated levels · US · UK · CA · AU">
              {data.advisories.length === 0 ? (
                <p className="text-[12px] text-muted">No elevated advisories changed recently.</p>
              ) : (
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {data.advisories.map((a) => (
                        <tr key={`${a.government}:${a.place}:${a.updatedAt}`} className="border-t border-line align-top">
                          <td className="py-1 pr-2 whitespace-nowrap text-faint">{GOV_NAME[a.government]}</td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            <Link href={a.url}>{a.place}</Link>
                          </td>
                          <td className="py-1 pr-2 text-muted">{a.advice}</td>
                          <td className="tabular py-1 text-right whitespace-nowrap text-faint">{a.updatedAt.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {data && data.failed.length > 0 && <p className="text-[11px] text-warn">Unavailable right now: {data.failed.join(", ")}</p>}
          <p className="text-[10.5px] text-faint">
            Sources: CISA Known Exploited Vulnerabilities catalog; NIST National Vulnerability Database (this product uses the NVD API but is not endorsed or
            certified by the NVD); U.S. Department of State; UK FCDO (Open Government Licence); Global Affairs Canada; Australian Government Smartraveller.
            Advisories are also shown on the map as Politics events.
          </p>
        </div>
      </div>
    </div>
  );
}
