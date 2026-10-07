/**
 * Live layers: continuously changing observations (aircraft, vessels, radar)
 * that are visualised on the globe but are NOT events — they never enter the
 * event store, scoring or deduplication.
 *
 * Layers are fetched on demand and cached for `ttlMs`, so upstream quotas are
 * only spent while someone is actually viewing the layer.
 */
export interface LayerSnapshot<T = unknown> {
  layerId: string;
  /** When the upstream data was observed/generated */
  observedAt: string;
  retrievedAt: string;
  count: number;
  data: T;
  attribution: string;
  notes?: string[];
}

export interface LayerContext {
  signal: AbortSignal;
  userAgent: string;
  env: Record<string, string | undefined>;
  now: number;
}

export interface LiveLayerProvider<T = unknown> {
  id: string;
  name: string;
  description: string;
  homepage: string;
  attribution: string;
  /** Minimum time between upstream fetches (respect quotas) */
  ttlMs: number;
  checkConfiguration?(env: Record<string, string | undefined>): string | null;
  load(ctx: LayerContext): Promise<LayerSnapshot<T>>;
  /**
   * Load at server start and refresh in the background before the TTL runs out; requests
   * never wait on upstream once a snapshot exists (an expired one is served while it refreshes).
   */
  background?: boolean;
  /** Turns the cached data into what the API serves (e.g. a compact form). Defaults to the data itself. */
  present?(data: T): unknown;
  /** Changes whenever `present` would return something different for the same data. */
  presentKey?(): string;
  /** Extra background work started once per process alongside the refresh (e.g. liveness sampling). */
  startBackground?(ctx: { snapshot: () => LayerSnapshot<T> | null; userAgent: string }): void;
}
