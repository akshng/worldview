/** USGS Volcano Hazards Program HANS public API. */
export interface ElevatedVolcano {
  obs_fullname: string;
  obs_abbr: string;
  volcano_name: string;
  vnum: string;
  notice_identifier: string;
  sent_utc: string;
  color_code: string | null;
  alert_level: string | null;
  notice_url: string | null;
}
export interface VolcanoInfo {
  vnum: string;
  latitude: number;
  longitude: number;
  region?: string | null;
  elevation_meters?: number | null;
}
export interface UsgsVolcanoRaw {
  elevated: ElevatedVolcano[];
  info: Record<string, VolcanoInfo>;
}
