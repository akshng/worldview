/** MeteoAlarm (EUMETNET) CAP warnings JSON per country. https://meteoalarm.org */
export interface MaInfo {
  language?: string;
  event?: string;
  headline?: string;
  description?: string;
  senderName?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  onset?: string;
  effective?: string;
  expires?: string;
  web?: string;
  responseType?: string[];
  parameter?: Array<{ valueName: string; value: string }>;
  area?: Array<{ areaDesc: string; geocode?: Array<{ valueName: string; value: string }> }>;
}

export interface MaWarning {
  alert: { identifier: string; msgType?: string; sent?: string; info: MaInfo[] };
  uuid?: string;
}

export interface MeteoAlarmRaw {
  countries: Array<{ slug: string; iso2: string; warnings: MaWarning[] }>;
}
