import type { EventRelationship, WorldEvent } from "@/types/events";
import type { EventQuery } from "@/lib/events/query";

export interface IngestionRun {
  id: string;
  dataSourceId: string;
  startedAt: string;
  completedAt: string | null;
  success: boolean;
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsDeduplicated: number;
  recordsSkipped: number;
  recordsInvalid: number;
  errors: string[];
  durationMs: number | null;
}

/**
 * Storage abstraction with two implementations:
 *   - MemoryEventRepository (default): in-memory + JSON snapshot in DATA_DIR
 *   - PostgresEventRepository: PostgreSQL server or embedded PGlite (DATABASE_URL)
 * Both pass the same contract tests (tests/repository.test.ts).
 */
export interface EventRepository {
  readonly kind: string;
  /** Load/connect/migrate. Idempotent. */
  init(): Promise<void>;
  get(id: string): Promise<WorldEvent | null>;
  getMany(ids: string[]): Promise<WorldEvent[]>;
  /** Lookup by `${dataSourceId}:${externalId}` source record id */
  findBySourceRecord(sourceRecordId: string): Promise<WorldEvent | null>;
  /** Spatial-temporal candidate search used by deduplication */
  findNear(params: { lat: number; lon: number; radiusKm: number; fromMs: number; toMs: number; type?: WorldEvent["type"] }): Promise<WorldEvent[]>;
  save(event: WorldEvent): Promise<void>;
  saveMany(events: WorldEvent[]): Promise<void>;
  query(q: Partial<EventQuery>): Promise<{ events: WorldEvent[]; total: number }>;
  /** Unpaginated filtered scan (for aggregates). */
  scan(q: Partial<EventQuery>): Promise<WorldEvent[]>;
  count(): Promise<number>;
  /** Delete events whose latest activity is older than `beforeMs`. Returns number removed. */
  prune(beforeMs: number): Promise<number>;
  /** Delete all events contributed solely by `dataSourceId` (used when switching modes) */
  removeBySource(dataSourceId: string): Promise<number>;

  addRelationship(rel: EventRelationship): Promise<void>;
  relationshipsFor(eventId: string): Promise<EventRelationship[]>;

  recordRun(run: IngestionRun): Promise<void>;
  listRuns(params?: { dataSourceId?: string; limit?: number }): Promise<IngestionRun[]>;

  /** Write any buffered state to disk now (memory repository). */
  flush?(): Promise<void>;
  /** Release connections (Postgres repository). */
  close?(): Promise<void>;

  /** Monotonic change counter (drives realtime notifications / client cache-busting). */
  version(): number;
}
