"use client";
/** Every event as a reading list, without the globe: wide feed on the left, the story on the right. */
import { EventFeed } from "@/components/event-feed/EventFeed";
import { EventPanel } from "@/components/event-panel/EventPanel";
import { StatsStrip } from "@/components/stats/StatsStrip";
import { useUI } from "@/lib/store/ui";

export function NewsPage() {
  const selected = useUI((s) => s.selectedEventId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <StatsStrip />
      </div>
      <div className="flex min-h-0 flex-1">
        <EventFeed wide />
        <div className="flex min-w-0 flex-1 justify-center overflow-y-auto p-4">
          {selected ? (
            <EventPanel />
          ) : (
            <div className="self-center text-center text-[13px] text-faint">
              <p className="text-muted">Pick a story on the left.</p>
              <p className="mt-1">Its sources, timeline and market exposure open here. Use the World page to see it on the globe.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
