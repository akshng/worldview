"use client";
/** Top-bar health dot: green / amber / red from /api/health (or /api/sources on older servers). Click → Sources. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { summarizeHealth, type HealthSummary } from "@/lib/client/health";
import { BATTERY_SLOWDOWN, onBattery } from "@/lib/client/power";
import { useUI } from "@/lib/store/ui";

const POLL_MS = 60_000;
const COLOR: Record<HealthSummary["level"], string> = { ok: "var(--live)", warn: "var(--warn)", bad: "var(--danger)", unknown: "var(--text-faint)" };
const WORD: Record<HealthSummary["level"], string> = { ok: "Healthy", warn: "Some problems", bad: "Many sources failing", unknown: "Checking…" };

export function HealthDot() {
  const [h, setH] = useState<HealthSummary | null>(null);
  const setView = useUI((s) => s.setView);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let ctrl: AbortController | null = null;
    let noHealthEndpoint = false;
    const load = async () => {
      ctrl = new AbortController();
      try {
        const health = noHealthEndpoint ? null : await api.health(ctrl.signal).catch(() => null);
        if (!health) noHealthEndpoint = true;
        setH(summarizeHealth(health, health ? null : (await api.sources(ctrl.signal)).sources));
      } catch {
        /* keep the last reading */
      }
      timer = setTimeout(tick, POLL_MS * (onBattery() ? BATTERY_SLOWDOWN : 1));
    };
    // Nobody's looking: check again when the page is visible.
    const tick = () => (document.hidden ? (timer = setTimeout(tick, POLL_MS)) : void load());
    void load();
    return () => {
      clearTimeout(timer);
      ctrl?.abort();
    };
  }, []);

  const level = h?.level ?? "unknown";
  return (
    <button
      onClick={() => setView("sources")}
      className="mr-1 flex h-8 items-center gap-1.5 rounded-md px-2 text-faint hover:bg-panel-hover hover:text-fg"
      title={`${WORD[level]} — ${h?.text ?? "checking sources"}. Click for the Sources page.`}
      aria-label={`Data health: ${WORD[level]}`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: COLOR[level], boxShadow: level === "bad" ? "0 0 6px var(--danger)" : undefined }} />
      <span className="meta hidden min-[1400px]:inline">Health</span>
    </button>
  );
}
