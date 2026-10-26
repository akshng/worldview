/** Server copy of the user's watchlist (the app syncs it here) so background jobs can watch it. */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export const WATCH_SYMBOL = /^[A-Z0-9^][A-Z0-9.=^-]{0,14}$/;
const file = () => path.resolve(process.cwd(), env().DATA_DIR, "watchlist.json");

export async function loadWatchlist(): Promise<string[]> {
  try {
    const d = JSON.parse(await readFile(file(), "utf8")) as { symbols?: unknown };
    if (Array.isArray(d.symbols)) return d.symbols.filter((s): s is string => typeof s === "string" && WATCH_SYMBOL.test(s)).slice(0, 25);
  } catch {
    /* none saved yet */
  }
  return (env().SETUP_WATCHLIST ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => WATCH_SYMBOL.test(s));
}

export async function saveWatchlist(symbols: string[]): Promise<string[]> {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => WATCH_SYMBOL.test(s)))].slice(0, 25);
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify({ symbols: clean, updatedAt: new Date().toISOString() }));
  return clean;
}
