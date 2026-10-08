/** AISStream.io websocket messages (subset). https://aisstream.io/documentation */
export interface AisStreamMessage {
  MessageType: string;
  MetaData: { MMSI: number; ShipName?: string; latitude: number; longitude: number; time_utc: string };
  Message: {
    PositionReport?: { Cog: number; Sog: number; TrueHeading: number; NavigationalStatus: number };
    StandardClassBPositionReport?: { Cog: number; Sog: number; TrueHeading: number };
    ShipStaticData?: {
      ImoNumber?: number;
      CallSign?: string;
      Name?: string;
      Type?: number;
      Dimension?: { A?: number; B?: number; C?: number; D?: number };
      Eta?: { Month?: number; Day?: number; Hour?: number; Minute?: number };
      MaximumStaticDraught?: number;
      Destination?: string;
    };
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
  source: "aisstream" | "digitraffic" | "keyless" | "viewport";
  /** Feeds that contributed to a keyless snapshot, with vessel counts */
  feeds?: Array<{ id: string; name: string; count: number; area: string; error?: string | null }>;
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
  /** decimetres */
  draught?: number;
  /** packed AIS ETA (month<<16 | day<<11 | hour<<6 | minute) */
  eta?: number;
  referencePointA?: number;
  referencePointB?: number;
  referencePointC?: number;
  referencePointD?: number;
}

/** Static / voyage data for one vessel, from whichever feed reported it. */
export interface VesselStatic {
  name?: string;
  imo?: number | null;
  callSign?: string;
  shipType?: number | null;
  destination?: string;
  /** ISO time */
  eta?: string | null;
  draughtM?: number | null;
  lengthM?: number | null;
  beamM?: number | null;
  /** ms epoch the static data was reported */
  updatedAt?: number;
}

/** GET /api/tracks/ship/:mmsi */
export interface VesselDetail extends VesselStatic {
  mmsi: number;
  mmsiKind: string;
  flag: { code: string | null; name: string | null };
  shipTypeLabel: string | null;
  lon: number | null;
  lat: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  navStatusLabel: string | null;
  /** ms epoch of the last position */
  observedAt: number | null;
  source: string;
  trail: Array<[number, number, number]>;
  links: Array<{ label: string; url: string }>;
}
