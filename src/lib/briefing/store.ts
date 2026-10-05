/**
 * Saved briefings (DATA_DIR/briefings/YYYY-MM-DD.json), written by the scheduled
 * morning job (scripts/morning-briefing.ts) so the app can show them later.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DailyBriefing } from "./index";

export interface SavedBriefing {
  /** Local calendar date (YYYY-MM-DD) the briefing belongs to */
  date: string;
  generatedAt: string;
  trigger: "scheduled" | "manual";
  briefing: DailyBriefing;
}

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const briefingsDir = (dataDir: string) => path.resolve(dataDir, "briefings");

export async function saveBriefing(dataDir: string, saved: SavedBriefing): Promise<string> {
  const dir = briefingsDir(dataDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${saved.date}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(saved, null, 2));
  await fs.rename(`${file}.tmp`, file);
  return file;
}

export async function loadBriefing(dataDir: string, date = localDate()): Promise<SavedBriefing | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(briefingsDir(dataDir), `${date}.json`), "utf8")) as SavedBriefing;
  } catch {
    return null;
  }
}
