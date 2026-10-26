/**
 * After-close job — run once, then exit (npm run close:run).
 *
 *   1. Post the US market-close wrap to Discord
 *   2. Scan for stock setups, add AI notes, post them
 *   3. Unload the AI model and exit, so nothing keeps running
 *
 * Skips weekends, market holidays and days already done. If the WorldView server
 * is running it asks the server to do the work (one writer for state); otherwise
 * it runs standalone. Scheduled by `npm run close:schedule` (macOS LaunchAgent).
 */
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const serverUrl = (process.env.WORLDVIEW_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const auth: Record<string, string> = process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};

async function serverIsRunning(): Promise<boolean> {
  try {
    return (await fetch(`${serverUrl}/api/meta`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function viaServer() {
  log(`server is running at ${serverUrl} — using it`);
  try {
    const res = await fetch(`${serverUrl}/api/discord/close`, { method: "POST", headers: auth, signal: AbortSignal.timeout(20 * 60_000) });
    const body = (await res.json().catch(() => ({}))) as { log?: string[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    for (const l of body.log ?? []) log(l);
  } finally {
    const un = await fetch(`${serverUrl}/api/ai/unload`, { method: "POST", headers: auth }).catch(() => null);
    log(un?.ok ? "asked server to unload the AI model" : "could not ask server to unload the AI model");
  }
}

async function standalone() {
  const { runCloseJobs } = await import("@/lib/notify/discord-server");
  const { getLocalProvider } = await import("@/lib/ai");
  try {
    for (const l of await runCloseJobs()) log(l);
  } finally {
    if (await getLocalProvider()?.unload()) log("AI model unloaded");
  }
}

const started = Date.now();
(async () => {
  if (await serverIsRunning()) await viaServer();
  else await standalone();
})()
  .then(() => {
    log(`done in ${Math.round((Date.now() - started) / 1000)}s — exiting`);
    process.exit(0);
  })
  .catch((err) => {
    log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
