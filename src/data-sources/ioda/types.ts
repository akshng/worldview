/** IODA (Georgia Tech Internet Outage Detection & Analysis) outage events. https://api.ioda.inetintel.cc.gatech.edu/v2/ */
export interface IodaEvent {
  location: string; // "country/NG"
  location_name: string;
  start: number; // unix seconds
  duration: number; // seconds
  method: string;
  datasource: string; // bgp | ping-slash24 | gtr | merit-nt
  status: number;
  score: number;
}
export interface IodaResponse {
  data: IodaEvent[] | null;
  error: string | null;
}
