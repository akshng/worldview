/** AISStream.io websocket messages (subset). https://aisstream.io/documentation */
export interface AisStreamMessage {
  MessageType: string;
  MetaData: { MMSI: number; ShipName?: string; latitude: number; longitude: number; time_utc: string };
  Message: {
    PositionReport?: { Cog: number; Sog: number; TrueHeading: number; NavigationalStatus: number };
  };
}

/** [mmsi, name, lon, lat, sogKnots, cogDeg, heading, navStatus, observedAtMs] */
export type VesselRow = [number, string, number, number, number | null, number | null, number | null, number | null, number];

export interface MaritimeData {
  fields: string[];
  rows: VesselRow[];
}
