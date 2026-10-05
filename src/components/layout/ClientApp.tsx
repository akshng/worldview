"use client";
import dynamic from "next/dynamic";

/**
 * The dashboard depends on the clock, WebGL and per-browser preferences, so it
 * renders on the client only (avoids SSR/client hydration mismatches).
 */
const Dashboard = dynamic(() => import("./Dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center"><span className="meta text-faint">Loading…</span></div>,
});

export function ClientApp() {
  return <Dashboard />;
}
