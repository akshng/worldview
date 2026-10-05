import { httpGet, type FetchContext } from "../types";
import type { MeteoAlarmRaw, MaWarning } from "./types";

/** MeteoAlarm feed slug → ISO 3166-1 alpha-2 */
export const METEOALARM_COUNTRIES: Record<string, string> = {
  austria: "AT", belgium: "BE", "bosnia-herzegovina": "BA", bulgaria: "BG", croatia: "HR", cyprus: "CY", czechia: "CZ",
  denmark: "DK", estonia: "EE", finland: "FI", france: "FR", germany: "DE", greece: "GR", hungary: "HU", iceland: "IS",
  ireland: "IE", israel: "IL", italy: "IT", latvia: "LV", lithuania: "LT", luxembourg: "LU", malta: "MT", moldova: "MD",
  montenegro: "ME", netherlands: "NL", "republic-of-north-macedonia": "MK", norway: "NO", poland: "PL", portugal: "PT",
  romania: "RO", serbia: "RS", slovakia: "SK", slovenia: "SI", spain: "ES", sweden: "SE", switzerland: "CH",
  ukraine: "UA", "united-kingdom": "GB",
};

export async function fetchMeteoAlarm(ctx: FetchContext): Promise<MeteoAlarmRaw> {
  const entries = Object.entries(METEOALARM_COUNTRIES);
  const countries: MeteoAlarmRaw["countries"] = [];
  const errors: string[] = [];
  // Polite: four countries at a time.
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(
      entries.slice(i, i + 4).map(async ([slug, iso2]) => {
        try {
          const j = (await (await httpGet(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${slug}`, ctx)).json()) as { warnings?: MaWarning[] };
          countries.push({ slug, iso2, warnings: j.warnings ?? [] });
        } catch (e) {
          errors.push(`${slug}: ${(e as Error).message}`);
        }
      }),
    );
  }
  if (!countries.length) throw new Error(`MeteoAlarm unavailable (${errors.slice(0, 3).join("; ")})`);
  return { countries };
}
