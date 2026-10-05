"use client";
import { create } from "zustand";
import type { EventSummary } from "@/types/events";
import type { MetaResponse } from "./api";

interface DataState {
  /** All events fetched for the current timeline span */
  events: EventSummary[];
  /** Events after layer/importance/time filtering — what the map & feed show */
  visible: EventSummary[];
  mode: "live" | "demo" | null;
  meta: MetaResponse | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /** Server repository version at last fetch */
  version: number;
  /** Bumped when the server reports a change to one event (e.g. AI interpretation added) */
  eventRevision: Record<string, number>;
}

export const useData = create<DataState>()(() => ({
  events: [],
  visible: [],
  mode: null,
  meta: null,
  loading: true,
  error: null,
  lastFetchedAt: null,
  version: 0,
  eventRevision: {},
}));
