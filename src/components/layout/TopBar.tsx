"use client";
import clsx from "clsx";
import { APP_NAME } from "@/lib/config/app";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { TIME_RANGES, formatClock } from "@/lib/time";
import { useNow } from "@/lib/client/use-now";
import { IconButton } from "@/components/ui/primitives";
import { SearchIcon, SettingsIcon } from "@/components/ui/icons";

export function TopBar() {
  const range = useUI((s) => s.range);
  const setRange = useUI((s) => s.setRange);
  const cursor = useUI((s) => s.timelineCursor);
  const autoRefresh = useUI((s) => s.settings.autoRefresh);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const openSettings = useUI((s) => s.openSettings);
  const setBriefingOpen = useUI((s) => s.setBriefingOpen);
  const setMarketsOpen = useUI((s) => s.setMarketsOpen);
  const visibleCount = useData((s) => s.visible.length);
  const mode = useData((s) => s.mode);
  const now = useNow(15_000);

  const status =
    cursor !== null
      ? { label: `REPLAY ${formatClock(cursor)}`, color: "var(--warn)", pulse: false }
      : autoRefresh
        ? { label: "LIVE", color: "var(--live)", pulse: true }
        : { label: "PAUSED", color: "var(--text-muted)", pulse: false };

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center border-b border-line bg-bg/95 px-4">
      {/* Left: wordmark */}
      <div className="flex w-[260px] items-center gap-2.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
          <path d="M3 12h18" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
        </svg>
        <span className="text-[13px] font-semibold tracking-[0.28em]">{APP_NAME.toUpperCase()}</span>
        {mode === "demo" && <span className="meta rounded-sm bg-warn/15 px-1.5 py-[1px] text-warn">Demo</span>}
      </div>

      {/* Centre: live status, count, range */}
      <div className="flex flex-1 items-center justify-center gap-5">
        <div className="flex items-center gap-2">
          <span className={clsx("h-2 w-2 rounded-full", status.pulse && "live-dot")} style={{ background: status.color }} />
          <span className="meta font-medium" style={{ color: status.color }}>{status.label}</span>
        </div>
        <div className="h-4 w-px bg-line" />
        <div className="flex items-baseline gap-2">
          <span className="meta text-faint">Events</span>
          <span className="tabular text-[13px] font-medium">{visibleCount.toLocaleString("en-US")}</span>
        </div>
        <div className="h-4 w-px bg-line" />
        <div className="flex rounded-md border border-line p-[2px]" role="radiogroup" aria-label="Time range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={range === r.id}
              onClick={() => setRange(r.id)}
              title={r.label}
              className={clsx(
                "meta rounded-[4px] px-2.5 py-1 transition-colors",
                range === r.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg",
              )}
            >
              {r.short}
            </button>
          ))}
        </div>
      </div>

      {/* Right: search, settings, clock */}
      <div className="flex w-[260px] items-center justify-end gap-1">
        <button
          onClick={() => setSearchOpen(true)}
          className="mr-1 flex h-8 w-36 items-center gap-2 rounded-md border border-line px-2.5 text-left text-[12px] text-faint transition-colors hover:border-line-strong hover:text-muted"
        >
          <SearchIcon width={14} height={14} />
          <span className="flex-1">Search</span>
          <kbd className="meta rounded border border-line px-1 text-faint">⌘K</kbd>
        </button>
        <IconButton onClick={() => setMarketsOpen(true)} title="Markets" aria-label="Markets" className="meta px-2.5">
          Markets
        </IconButton>
        <IconButton onClick={() => useUI.getState().setPlanetOpen(true)} title="Planet: climate & space weather" aria-label="Planet" className="meta px-2.5">
          Planet
        </IconButton>
        <IconButton onClick={() => setBriefingOpen(true)} title="Daily briefing" aria-label="Daily briefing" className="meta px-2.5">
          Briefing
        </IconButton>
        <IconButton onClick={() => openSettings()} title="Settings" aria-label="Settings">
          <SettingsIcon />
        </IconButton>
        <span className="meta tabular ml-2 text-faint" title="Coordinated Universal Time">{formatClock(now, true)} UTC</span>
      </div>
    </header>
  );
}
