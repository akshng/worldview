"use client";
/** Every data source WorldView pulls from, live status and run-now (moved out of Settings). */
import { SourcesList } from "@/components/settings/SettingsModal";

export function SourcesPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <div className="meta text-accent">Data sources</div>
      <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Where every piece of data comes from</h2>
      <p className="mt-1 mb-4 text-[12px] text-faint">Free, public feeds. Each event links back to its source. Status refreshes every few seconds.</p>
      <SourcesList />
    </div>
  );
}
