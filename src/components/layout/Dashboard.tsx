"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { useLiveData } from "@/lib/client/use-live-data";
import { syncWatchlist } from "@/lib/client/api";
import { useAppBridge } from "@/lib/client/app-bridge";
import { useNow } from "@/lib/client/use-now";
import { filterEvents } from "@/lib/events/client-filter";
import { IMPORTANCE_FILTERS } from "@/lib/categories";
import { visibleWindow } from "@/lib/time";
import { NavRail } from "./NavRail";
import { NewsPage } from "./NewsPage";
import { CountriesPage } from "./CountriesPage";
import { ChartsPage } from "@/components/charts/ChartsPage";
import { SourcesPage } from "./SourcesPage";
import { PageModeContext } from "./page-mode";
import { TopBar } from "./TopBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { EventFeed } from "@/components/event-feed/EventFeed";
import { EventPanel } from "@/components/event-panel/EventPanel";
import { CountryPanel } from "@/components/country-panel/CountryPanel";
import { RegionPanel } from "@/components/region-panel/RegionPanel";
import { TrackPanel } from "@/components/track-panel/TrackPanel";
import { Timeline } from "@/components/timeline/Timeline";
import { StatsStrip } from "@/components/stats/StatsStrip";
import { SearchPalette } from "@/components/search/SearchPalette";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { Legend } from "@/components/globe/Legend";
import { BriefingModal } from "@/components/briefing/BriefingModal";
import { MarketsPanel } from "@/components/markets/MarketsPanel";
import { PlanetPanel } from "@/components/planet/PlanetPanel";
import { EnergyPanel } from "@/components/energy/EnergyPanel";
import { SecurityPanel } from "@/components/security/SecurityPanel";
import { TrendsPanel } from "@/components/trends/TrendsPanel";
import { InstrumentDetail } from "@/components/markets/InstrumentDetail";
import { AnalystPanel } from "@/components/analyst/AnalystPanel";
import { Toasts, useAlertChecker } from "@/components/markets/Alerts";
import { modeMeta } from "@/lib/map-modes";
import { useLiveLayer } from "@/lib/client/use-live-layer";

// WebGL map is client-only.
const Globe = dynamic(() => import("@/components/globe/Globe"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center"><span className="meta text-faint">Loading globe…</span></div>,
});

export function Dashboard() {
  useLiveData();
  useAlertChecker();
  useAppBridge();
  const watchlist = useUI((s) => s.settings.watchlist);
  useEffect(() => {
    void syncWatchlist(watchlist);
  }, [watchlist]);
  const events = useData((s) => s.events);
  const mode = useData((s) => s.mode);
  const loading = useData((s) => s.loading);
  const categories = useUI((s) => s.categories);
  const importance = useUI((s) => s.importance);
  const range = useUI((s) => s.range);
  const customRange = useUI((s) => s.customRange);
  const cursor = useUI((s) => s.timelineCursor);
  const selectedEventId = useUI((s) => s.selectedEventId);
  const selectedCountry = useUI((s) => s.selectedCountry);
  const selectedRegion = useUI((s) => s.selectedRegion);
  const selectedTrack = useUI((s) => s.selectedTrack);
  const mapMode = useUI((s) => s.mapMode);
  const view = useUI((s) => s.view);
  const sourceFilter = useUI((s) => s.sourceFilter);
  const plot = useUI((s) => s.plot);
  const visibleCount = useData((s) => s.visible.length);
  const now = useNow(30_000);
  const modeInfo = modeMeta(mapMode);
  // The globe's live layer only runs on the World page.
  const live = useLiveLayer<unknown>(view === "world" ? modeInfo.liveLayer : null);

  const win = useMemo(() => visibleWindow(range, now, cursor, customRange), [range, now, cursor, customRange]);
  const globeWindow = useMemo(() => ({ from: win.from, to: win.to ?? now }), [win, now]);

  useEffect(() => {
    const min = IMPORTANCE_FILTERS.find((f) => f.id === importance)?.min ?? 0;
    // Focus modes (earthquakes, fires, …) override the layer toggles.
    const cats = new Set(modeInfo.categories ?? categories);
    useData.setState({
      visible: filterEvents(events, { categories: cats, minImportance: min, window: win, sources: new Set(sourceFilter), ids: plot ? new Set(plot.ids) : null }),
    });
  }, [events, categories, importance, win, modeInfo.categories, sourceFilter, plot]);

  // Esc closes the country / region panel (event and track panels handle their own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const ui = useUI.getState();
      if (ui.searchOpen || ui.settingsOpen || ui.selectedEventId || ui.selectedTrack) return;
      if (ui.selectedRegion !== null) ui.selectRegion(null);
      else if (ui.selectedCountry) ui.selectCountry(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {mode === "demo" && (
        <div className="z-10 flex h-7 shrink-0 items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 text-[12px] text-warn">
          <span className="meta font-semibold">Demo mode</span>
          <span>Data shown on this map is simulated and does not describe real events.</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <NavRail />
        {view === "world" ? (
          <>
        <Sidebar />
        <main className="relative min-w-0 flex-1 overflow-hidden bg-bg">
          <Globe window={globeWindow} live={live.data} />
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
            <div className={`flex items-start overflow-hidden ${selectedEventId || selectedCountry || selectedRegion !== null || selectedTrack ? "max-w-[calc(100%-412px)]" : ""}`}>
              <StatsStrip />
            </div>
            {(plot || sourceFilter.length > 0) && (
              <div className="glass pointer-events-auto mt-2 flex items-center gap-3 self-start rounded-md px-3 py-1.5 text-[12.5px]">
                <span className="text-accent">●</span>
                <span>{plot ? `Plotting ${plot.ids.length} event${plot.ids.length === 1 ? "" : "s"}: ${plot.label}` : `Plotting ${sourceFilter.length} source${sourceFilter.length === 1 ? "" : "s"} only`}</span>
                {visibleCount === 0 && !plot && range !== "7d" && (
                  <button className="text-warn underline" onClick={() => useUI.getState().setRange("7d")} title="Nothing from these sources in the current time range">
                    None in this time range · show 7 days
                  </button>
                )}
                <button className="text-muted underline hover:text-fg" onClick={() => (plot ? useUI.getState().setPlot(null) : useUI.getState().setSourceFilter([]))}>
                  Show everything
                </button>
              </div>
            )}
            <div className="flex-1" />
            {!loading && events.length === 0 && (
              <div className="glass pointer-events-auto mx-auto mb-3 rounded-md px-4 py-2.5 text-center text-[12.5px] text-muted">
                <span className="text-fg">No data available yet.</span> Sources may still be loading — see Settings → Data sources.
              </div>
            )}
            <div className="mb-2">
              <Legend live={live} />
            </div>
            <div className="mr-12 mb-4">
              <Timeline />
            </div>
          </div>
          {/* Detail panels float over the globe's right edge; the camera pads for them. */}
          {(selectedEventId || selectedCountry || selectedRegion !== null || selectedTrack) && (
            <div className="pointer-events-none absolute top-3 right-3 bottom-[104px] flex">
              {selectedTrack ? <TrackPanel /> : selectedEventId ? <EventPanel /> : selectedRegion !== null ? <RegionPanel /> : <CountryPanel />}
            </div>
          )}
        </main>
        <EventFeed />
          </>
        ) : (
          // Other pages: the globe isn't mounted at all (no WebGL, no map updates).
          <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
            <PageModeContext.Provider value={true}>
              {view === "news" && <NewsPage />}
              {view === "countries" && <CountriesPage />}
              {view === "charts" && <ChartsPage />}
              {view === "sources" && <SourcesPage />}
              {view === "markets" && <MarketsPanel />}
              {view === "analyst" && <AnalystPanel />}
              {view === "briefing" && <BriefingModal />}
              {view === "planet" && <PlanetPanel />}
              {view === "energy" && <EnergyPanel />}
              {view === "security" && <SecurityPanel />}
              {view === "trends" && <TrendsPanel />}
            </PageModeContext.Provider>
          </main>
        )}
      </div>
      <SearchPalette />
      <SettingsModal />
      <InstrumentDetail />
      <Toasts />
    </div>
  );
}
