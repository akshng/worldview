/** NOAA Storm Prediction Center filtered local storm reports (CSV, three sections). */
export interface SpcDay {
  /** Report day (YYMMDD) — covers 12:00 UTC that day to 11:59 UTC the next */
  day: string;
  csv: string;
}
export interface SpcRaw {
  days: SpcDay[];
}
