"use client";
/**
 * Latest live-tracking data the globe has loaded (ships, aircraft, military
 * aircraft, satellites), shared with the track detail panel so it shows the
 * same positions as the map without fetching them again.
 */
import { create } from "zustand";
import type { MaritimeData } from "@/layers/maritime/types";
import type { AircraftData } from "@/layers/aircraft/parser";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { PreparedSat } from "@/components/globe/tracking";

interface TrackingState {
  ships: MaritimeData | null;
  aircraft: AircraftData | null;
  /** Aircraft from the OpenSky "Aviation" map mode, in the same row form */
  aviation: AircraftData | null;
  mil: MilitaryAircraftData | null;
  sats: PreparedSat[];
  /** Recent positions of the selected object, [lon, lat, ms][], from the detail API */
  trail: Array<[number, number, number]>;
}

export const useTracking = create<TrackingState>()(() => ({ ships: null, aircraft: null, aviation: null, mil: null, sats: [], trail: [] }));
