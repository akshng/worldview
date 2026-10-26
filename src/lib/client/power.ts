"use client";
/**
 * Battery awareness. The Mac app tells the page when the Mac is on battery
 * (`window.__wvPower`, plus a `wv-power` event); in a plain browser this is
 * unknown and treated as plugged in. On battery the page refreshes less often.
 */
declare global {
  interface Window {
    __wvPower?: "battery" | "ac";
  }
}

export const onBattery = () => typeof window !== "undefined" && window.__wvPower === "battery";

type BatteryManager = EventTarget & { charging: boolean };

/**
 * In a browser (Chrome, Edge…) read the battery directly. The Mac app sets
 * `__wvPower` itself (WebKit has no Battery API), so this only fills the gap.
 */
export function watchBrowserBattery() {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (!nav.getBattery || window.__wvPower) return;
  void nav
    .getBattery()
    .then((b) => {
      const set = () => {
        window.__wvPower = b.charging ? "ac" : "battery";
        window.dispatchEvent(new Event("wv-power"));
      };
      set();
      b.addEventListener("chargingchange", set);
    })
    .catch(() => {});
}

/** Multiply background refresh intervals by this on battery. */
export const BATTERY_SLOWDOWN = 4;

/**
 * On battery and nobody's looking (another app is in front, or the page is hidden):
 * skip background map updates entirely. They resume when WorldView is focused.
 */
export const idleOnBattery = () => typeof document !== "undefined" && onBattery() && (document.hidden || !document.hasFocus());
