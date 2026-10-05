/** Environment Agency real-time flood-monitoring API (England). */
export interface UkFloodWarning {
  "@id": string;
  description: string;
  eaAreaName?: string;
  floodAreaID: string;
  floodArea?: { county?: string; riverOrSea?: string; notation?: string };
  isTidal?: boolean;
  message?: string;
  severity: string;
  /** 1 severe flood warning · 2 flood warning · 3 flood alert · 4 no longer in force */
  severityLevel: number;
  timeRaised?: string;
  timeMessageChanged?: string;
  timeSeverityChanged?: string;
}
export interface UkFloodArea {
  lat: number;
  long: number;
  label?: string;
  county?: string;
}
export interface UkFloodsRaw {
  items: UkFloodWarning[];
  areas: Record<string, UkFloodArea>;
}
