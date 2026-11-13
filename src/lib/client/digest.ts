/**
 * "Since you last looked": what's new since this browser's last visit. Pure helpers shared
 * by GET /api/digest (events + setups) and the digest card (last-visit bookkeeping, moves).
 */

/** High importance, as in the importance filter's "High+". */
export const DIGEST_MIN_IMPORTANCE = 61;
/** Show the card after this long away (and on open when the last visit was this long ago). */
export const DIGEST_AWAY_MS = 2 * 3_600_000;
/** Watchlist moves at least this big (today, %) are "notable". */
export const NOTABLE_MOVE_PCT = 2;
export const LAST_VISIT_KEY = "worldview-last-visit";

export interface DigestInputEvent {
  id: string;
  type: string;
  title: string;
  importanceScore: number;
  status: string;
  isSynthetic: boolean;
  countryName: string | null;
  locationName: string | null;
  latitude: number;
  longitude: number;
  timestamp: string;
  /** When WorldView first saw it (falls back to the event time) */
  createdAt?: string;
}

export interface DigestEvent {
  id: string;
  type: string;
  title: string;
  importanceScore: number;
  where: string | null;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface DigestSetup {
  date: string;
  symbol: string;
  name: string;
  score: number;
  signals: string[];
}

export interface Digest {
  since: string;
  generatedAt: string;
  /** New high-importance events */
  highCount: number;
  byCategory: Array<{ type: string; count: number }>;
  top: DigestEvent[];
  setups: DigestSetup[];
}

export function buildDigest(events: DigestInputEvent[], since: number, now = Date.now(), minImportance = DIGEST_MIN_IMPORTANCE): Omit<Digest, "setups"> {
  const fresh = events.filter((e) => {
    if (e.isSynthetic || e.status === "RESOLVED" || e.importanceScore < minImportance) return false;
    const seen = Date.parse(e.createdAt ?? e.timestamp);
    return seen > since && seen <= now;
  });
  const counts = new Map<string, number>();
  for (const e of fresh) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const top = [...fresh]
    .sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 5)
    .map((e) => ({ id: e.id, type: e.type, title: e.title, importanceScore: e.importanceScore, where: e.countryName ?? e.locationName, latitude: e.latitude, longitude: e.longitude, timestamp: e.timestamp }));
  return {
    since: new Date(since).toISOString(),
    generatedAt: new Date(now).toISOString(),
    highCount: fresh.length,
    byCategory: [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    top,
  };
}

/** Setups posted on or after the New York date of `since`. */
export function setupsSince<T extends { date: string }>(picks: T[], since: number): T[] {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(since);
  return picks.filter((p) => p.date >= day).sort((a, b) => b.date.localeCompare(a.date));
}

export function notableMoves<T extends { symbol: string; changePct: number | null }>(quotes: T[], minPct = NOTABLE_MOVE_PCT): T[] {
  return quotes.filter((q) => q.changePct !== null && Math.abs(q.changePct) >= minPct).sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!));
}

/** Should the card open? Only after a real absence, never on the very first visit. */
export function shouldShowDigest(lastVisit: number | null, now = Date.now(), awayMs = DIGEST_AWAY_MS): boolean {
  return lastVisit !== null && Number.isFinite(lastVisit) && now - lastVisit >= awayMs;
}

/** localStorage, but never throws (private windows, blocked storage). */
export function readLastVisit(): number | null {
  try {
    const v = Number(window.localStorage.getItem(LAST_VISIT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
export function writeLastVisit(t = Date.now()) {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, String(t));
  } catch {
    /* storage unavailable */
  }
}
