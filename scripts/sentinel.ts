/**
 * Battery sentinel — run once, then exit (npm run sentinel). Scheduled every
 * 15 minutes by `npm run power:install`. If the main server is running it does
 * nothing (the server already sends alerts); otherwise it runs the cheap check
 * in src/lib/notify/sentinel.ts, which only loads the AI when something trips.
 */
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const serverUrl = (process.env.WORLDVIEW_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

(async () => {
  try {
    if ((await fetch(`${serverUrl}/api/meta`, { signal: AbortSignal.timeout(2000) })).ok) return; // server handles alerts
  } catch {
    /* server off — run */
  }
  const { runSentinel } = await import("@/lib/notify/sentinel");
  for (const l of await runSentinel()) log(l);
})()
  .then(() => process.exit(0))
  .catch((err) => {
    log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
