"use client";
/** Left navigation: the app's pages. The globe is just one of them ("World"). */
import clsx from "clsx";
import type { ReactNode } from "react";
import { useUI, type AppView } from "@/lib/store/ui";

const I = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

export const NAV: Array<{ id: AppView; label: string; hint: string; icon: ReactNode }> = [
  { id: "world", label: "World", hint: "The live globe", icon: I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>) },
  { id: "news", label: "News", hint: "Every event as a feed", icon: I(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>) },
  { id: "countries", label: "Countries", hint: "Every country: profile, events, advisories", icon: I(<><path d="M4 21V4M4 4h11l-2 4 2 4H4" /></>) },
  { id: "markets", label: "Markets", hint: "Cross-asset markets, stocks, filings", icon: I(<path d="M4 18 9 12l4 3 7-9M15 6h5v5" />) },
  { id: "analyst", label: "Analyst", hint: "Ask the AI analyst", icon: I(<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />) },
  { id: "briefing", label: "Briefing", hint: "Daily briefing", icon: I(<><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" /></>) },
  { id: "planet", label: "Planet", hint: "Climate and space weather", icon: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>) },
  { id: "energy", label: "Energy", hint: "Live electricity grids", icon: I(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />) },
  { id: "security", label: "Security", hint: "Cyber threats and travel advisories", icon: I(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />) },
  { id: "trends", label: "Trends", hint: "What people are searching and sharing", icon: I(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />) },
  { id: "sources", label: "Sources", hint: "Every data source and its status", icon: I(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>) },
];

export function NavRail() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-stretch gap-0.5 border-r border-line bg-bg py-2" aria-label="Pages">
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => setView(n.id)}
          title={n.hint}
          aria-current={view === n.id ? "page" : undefined}
          className={clsx(
            "mx-1.5 flex flex-col items-center gap-1 rounded-md py-2 text-[10.5px] transition-colors",
            view === n.id ? "bg-panel-hover text-fg" : "text-muted hover:bg-panel-hover/60 hover:text-fg",
            n.id === "analyst" && view !== n.id && "text-ai",
          )}
        >
          {n.icon}
          <span>{n.label}</span>
        </button>
      ))}
    </nav>
  );
}
