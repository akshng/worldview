/** Upcoming earnings dates from Nasdaq's public earnings calendar (keyless, unofficial). */

export interface UpcomingEarnings {
  symbol: string;
  name: string;
  date: string;
  when: "before open" | "after close" | "time not set";
  epsForecast: string | null;
  lastYearEps: string | null;
}

export function parseNasdaqEarnings(json: unknown, date: string): UpcomingEarnings[] {
  const rows = (json as { data?: { rows?: Array<Record<string, string>> | null } })?.data?.rows ?? [];
  return rows
    .filter((r) => r.symbol)
    .map((r) => ({
      symbol: r.symbol.toUpperCase(),
      name: r.name ?? r.symbol,
      date,
      when: r.time === "time-pre-market" ? "before open" : r.time === "time-after-hours" ? "after close" : "time not set",
      epsForecast: r.epsForecast && r.epsForecast !== "" ? r.epsForecast : null,
      lastYearEps: r.lastYearEPS && r.lastYearEPS !== "" ? r.lastYearEPS : null,
    }));
}

export async function earningsOn(date: string): Promise<UpcomingEarnings[]> {
  const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nasdaq earnings HTTP ${res.status}`);
  return parseNasdaqEarnings(await res.json(), date);
}
