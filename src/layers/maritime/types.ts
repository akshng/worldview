/** AISStream.io websocket messages (subset). https://aisstream.io/documentation */
export interface AisStreamMessage {
  MessageType: string;
  MetaData: { MMSI: number; ShipName?: string; latitude: number; longitude: number; time_utc: string };
  Message: {
    PositionReport?: { Cog: number; Sog: number; TrueHeading: number; NavigationalStatus: number };
  };
}

/**
 * [mmsi, name, lon, lat, sogKnots, cogDeg, heading, navStatus, observedAtMs, shipType, destination]
 * shipType is the AIS "type of ship and cargo" code (1–99) when known.
 */
export type VesselRow = [
  number,
  string,
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number,
  number | null,
  string | null,
];

export interface MaritimeData {
  fields: string[];
  rows: VesselRow[];
  /** Which upstream fed this snapshot */
  source: "aisstream" | "digitraffic";
}

/** Digitraffic marine /api/ais/v1/locations (GeoJSON FeatureCollection, subset). */
export interface DigitrafficLocations {
  dataUpdatedTime?: string;
  features?: Array<{
    mmsi?: number;
    geometry?: { coordinates?: [number, number] };
    properties?: { mmsi?: number; sog?: number; cog?: number; navStat?: number; heading?: number; timestampExternal?: number };
  }>;
}

/** Digitraffic marine /api/ais/v1/vessels (static/voyage data, subset). */
export interface DigitrafficVessel {
  mmsi?: number;
  name?: string;
  shipType?: number;
  destination?: string;
  callSign?: string;
  imo?: number;
  timestamp?: number;
}
