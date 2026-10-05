/** OpenSky Network /states/all — https://openskynetwork.github.io/opensky-api/rest.html */
export type OpenSkyState = [
  icao24: string,
  callsign: string | null,
  originCountry: string,
  timePosition: number | null,
  lastContact: number,
  longitude: number | null,
  latitude: number | null,
  baroAltitude: number | null,
  onGround: boolean,
  velocity: number | null,
  trueTrack: number | null,
  verticalRate: number | null,
  sensors: number[] | null,
  geoAltitude: number | null,
  squawk: string | null,
  spi: boolean,
  positionSource: number,
];

export interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

/** Compact row sent to the browser: [icao24, callsign, country, lon, lat, altitudeM, speedMs, track, onGround, squawk] */
export type AircraftRow = [string, string, string, number, number, number | null, number | null, number | null, boolean, string | null];

export interface AviationData {
  fields: string[];
  rows: AircraftRow[];
}
