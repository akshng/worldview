"use client";
/** In-app price alerts (no push/notification infrastructure) and toast display. */
import { useEffect } from "react";
import { api } from "@/lib/client/api";
import { useUI, type PriceAlert } from "@/lib/store/ui";

export function useAlertChecker() {
  const alerts = useUI((s) => s.settings.alerts);
  useEffect(() => {
    if (!alerts.length) return;
    const check = async () => {
      const ui = useUI.getState();
      const current = ui.settings.alerts;
      try {
        const { quotes } = await api.quotes(current.map((a) => a.symbol));
        let changed = false;
        const next = current.map((a): PriceAlert => {
          const q = quotes.find((x) => x.symbol === a.symbol);
          if (!q || q.price === null) return a;
          const side: PriceAlert["fired"] = a.above !== null && q.price >= a.above ? "above" : a.below !== null && q.price <= a.below ? "below" : null;
          if (side && side !== a.fired) {
            ui.pushToast({ title: `${a.symbol} ${side === "above" ? "rose above" : "fell below"} ${side === "above" ? a.above : a.below}`, body: `Now ${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} (delayed quote).`, symbol: a.symbol });
            changed = true;
            return { ...a, fired: side };
          }
          if (!side && a.fired) {
            changed = true;
            return { ...a, fired: null }; // re-arm once price is back inside the band
          }
          return a;
        });
        if (changed) ui.updateSettings({ alerts: next });
      } catch {
        /* quotes unavailable; try again next tick */
      }
    };
    void check();
    const t = setInterval(check, 3 * 60_000);
    return () => clearInterval(t);
  }, [alerts.length]);
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const openInstrument = useUI((s) => s.openInstrument);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismiss(toasts[0].id), 15_000);
    return () => clearTimeout(t);
  }, [toasts, dismiss]);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="glass pointer-events-auto rounded-md px-3 py-2.5 shadow-xl shadow-black/50">
          <div className="flex items-start justify-between gap-2">
            <button className="text-left" onClick={() => t.symbol && openInstrument(t.symbol)}>
              <div className="meta text-warn">Price alert</div>
              <div className="mt-0.5 text-[13px] font-medium">{t.title}</div>
              <div className="text-[12px] text-muted">{t.body}</div>
            </button>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
