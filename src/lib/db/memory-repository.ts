/**
 * In-memory EventRepository with debounced JSON snapshot persistence.
 *
 * Good for a single local process (V1). Uses a 1° grid index for spatial
 * candidate lookups. Swap for a PostgreSQL/PostGIS implementation of
 * `EventRepository` when multi-process or larger volumes are needed.
 */
import { renameSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventRelationship, WorldEvent } from "@/types/events";
import { matchesQuery, sortEvents, type EventQuery } from "@/lib/events/query";
import { recompute } from "@/lib/events/build";
import { migrateLegacyEvent, retentionTime } from "@/lib/events/compact";
import { collapseDuplicates } from "@/lib/ingestion/collapse";
import { decodeEvent, encodeEvent, StringTable } from "./snapshot-codec";
import { gridKey, haversineKm } from "@/lib/geo/math";
import type { EventRepository, IngestionRun } from "./types";

const CELL = 1; // degrees
/** 2 = compact event encoding (snapshot-codec.ts). Version 1 snapshots are migrated on load. */
const SNAPSHOT_VERSION = 2;
/** Ingestion runs kept per source (so 6 h / 24 h sources keep their history across restarts). */
const RUNS_PER_SOURCE = 20;
/** Snapshot debounce: the store is tens of MB, so write at most about every 30 s. */
const SAVE_DEBOUNCE_MS = 30_000;

interface Snapshot {
  version: number;
  savedAt: string;
  events: unknown[];
  /** Shared strings referenced by index from events (version 2). */
  strings?: string[];
  relationships: EventRelationship[];
  runs: IngestionRun[];
}

/** Snapshot form: compact, lossless encoding; scores are recomputed on load. */
function snapshotOf(events: Iterable<WorldEvent>, relationships: EventRelationship[], runs: IngestionRun[]): Snapshot {
  const table = new StringTable();
  const encoded = [...events].map((e) => encodeEvent(e, table));
  return { version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(), strings: table.strings, events: encoded, relationships, runs };
}

/**
 * Bring a loaded snapshot up to date: apply the store caps (sources, timeline, raw
 * data), backfill outlet counts / evidence times, rescore, and collapse duplicates
 * stored by older versions (warning series, identical headlines across feeds).
 */
export function migrateSnapshot(input: WorldEvent[], rels: EventRelationship[], now = Date.now()): { events: WorldEvent[]; relationships: EventRelationship[] } {
  const { events, remap } = collapseDuplicates(input.map((e) => recompute(migrateLegacyEvent(e), now)), now);
  if (!remap.size) return { events, relationships: rels };
  const seen = new Set<string>();
  const relationships: EventRelationship[] = [];
  for (const r of rels) {
    const from = remap.get(r.fromEventId) ?? r.fromEventId, to = remap.get(r.toEventId) ?? r.toEventId;
    const key = [r.type, ...[from, to].sort()].join("|");
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    relationships.push(from === r.fromEventId && to === r.toEventId ? r : { ...r, fromEventId: from, toEventId: to });
  }
  return { events, relationships };
}

export class MemoryEventRepository implements EventRepository {
  readonly kind = "memory";
  private events = new Map<string, WorldEvent>();
  private bySourceRecord = new Map<string, string>();
  private grid = new Map<string, Set<string>>();
  private relationships: EventRelationship[] = [];
  private runs: IngestionRun[] = [];
  private _version = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private dirtyDuringFlush = false;
  private loaded: Promise<void> | null = null;

  constructor(private readonly snapshotFile: string | null) {}

  /** Load the snapshot once. Safe to call repeatedly. */
  init(): Promise<void> {
    if (!this.loaded) this.loaded = this.load();
    return this.loaded;
  }

  private async load() {
    if (!this.snapshotFile) return;
    try {
      const raw = await fs.readFile(this.snapshotFile, "utf8");
      const snap = JSON.parse(raw) as Snapshot;
      if (snap.version !== SNAPSHOT_VERSION && snap.version !== 1) return;
      const table = new StringTable(snap.strings ?? []);
      const stored = snap.version === 1 ? (snap.events as WorldEvent[]) : (snap.events as Record<string, unknown>[]).map((o) => decodeEvent(o, table));
      const { events, relationships } = migrateSnapshot(stored, snap.relationships ?? []);
      for (const e of events) this.index(e);
      this.relationships = relationships;
      this.runs = snap.runs ?? [];
      this._version++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[repository] could not load snapshot, starting empty:", (err as Error).message);
      }
    }
  }

  private scheduleSave() {
    this._version++;
    if (!this.snapshotFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  /** Write the snapshot. Single-flight: overlapping calls wait for the write in progress, then write once more. */
  async flush(): Promise<void> {
    if (!this.snapshotFile) return;
    if (this.flushing) {
      this.dirtyDuringFlush = true;
      return this.flushing;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flushing = this.writeSnapshot().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
    if (this.dirtyDuringFlush) {
      this.dirtyDuringFlush = false;
      await this.flush();
    }
  }

  /** Synchronous write for shutdown signals (async work may not finish before exit). */
  flushSync() {
    if (!this.snapshotFile) return;
    try {
      const snap = snapshotOf(this.events.values(), this.relationships, this.runs);
      const tmp = `${this.snapshotFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(snap));
      renameSync(tmp, this.snapshotFile);
    } catch (err) {
      console.warn("[repository] shutdown snapshot failed:", (err as Error).message);
    }
  }

  private async writeSnapshot() {
    if (!this.snapshotFile) return;
    const snap = snapshotOf(this.events.values(), this.relationships, this.runs);
    try {
      await fs.mkdir(path.dirname(this.snapshotFile), { recursive: true });
      // Per-process temp name: a run-once job and the server can't clobber each other's temp file.
      const tmp = `${this.snapshotFile}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snap));
      await fs.rename(tmp, this.snapshotFile);
    } catch (err) {
      console.warn("[repository] snapshot write failed:", (err as Error).message);
    }
  }

  private index(e: WorldEvent) {
    const prev = this.events.get(e.id);
    if (prev) this.unindex(prev);
    this.events.set(e.id, e);
    for (const s of e.sources) this.bySourceRecord.set(s.id, e.id);
    const k = gridKey(e.latitude, e.longitude, CELL);
    let set = this.grid.get(k);
    if (!set) this.grid.set(k, (set = new Set()));
    set.add(e.id);
  }

  private unindex(e: WorldEvent) {
    this.events.delete(e.id);
    for (const s of e.sources) if (this.bySourceRecord.get(s.id) === e.id) this.bySourceRecord.delete(s.id);
    this.grid.get(gridKey(e.latitude, e.longitude, CELL))?.delete(e.id);
  }

  async get(id: string) {
    return this.events.get(id) ?? null;
  }

  async getMany(ids: string[]) {
    return ids.map((id) => this.events.get(id)).filter((e): e is WorldEvent => !!e);
  }

  async findBySourceRecord(sourceRecordId: string) {
    const id = this.bySourceRecord.get(sourceRecordId);
    return id ? (this.events.get(id) ?? null) : null;
  }

  async findNear({ lat, lon, radiusKm, fromMs, toMs, type }: Parameters<EventRepository["findNear"]>[0]) {
    const dLat = radiusKm / 111 + CELL;
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    const dLon = Math.min(radiusKm / (111 * cosLat) + CELL, 180);
    const out: WorldEvent[] = [];
    const seen = new Set<string>();
    for (let la = Math.floor((lat - dLat) / CELL); la <= Math.floor((lat + dLat) / CELL); la++) {
      for (let lo = Math.floor((lon - dLon) / CELL); lo <= Math.floor((lon + dLon) / CELL); lo++) {
        // wrap longitude cells across the antimeridian
        const wrapped = ((((lo * CELL + 180) % 360) + 360) % 360) - 180;
        const ids = this.grid.get(`${la}:${Math.floor(wrapped / CELL)}`);
        if (!ids) continue;
        for (const id of ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.events.get(id)!;
          if (type && e.type !== type) continue;
          const t = Date.parse(e.timestamp);
          if (t < fromMs || t > toMs) continue;
          if (haversineKm(lat, lon, e.latitude, e.longitude) <= radiusKm) out.push(e);
        }
      }
    }
    return out;
  }

  async save(event: WorldEvent) {
    this.index(event);
    this.scheduleSave();
  }

  async saveMany(events: WorldEvent[]) {
    for (const e of events) this.index(e);
    if (events.length) this.scheduleSave();
  }

  async scan(q: Partial<EventQuery>) {
    const out: WorldEvent[] = [];
    for (const e of this.events.values()) if (matchesQuery(e, q)) out.push(e);
    return out;
  }

  async query(q: Partial<EventQuery>) {
    const matched = sortEvents(await this.scan(q), q.sort ?? "recent");
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 500;
    return { events: matched.slice(offset, offset + limit), total: matched.length };
  }

  async count() {
    return this.events.size;
  }

  async prune(beforeMs: number) {
    let n = 0;
    for (const e of [...this.events.values()]) {
      // Retention follows the last distinct new evidence, not every merge touch.
      if (retentionTime(e) < beforeMs) {
        this.unindex(e);
        n++;
      }
    }
    if (n) {
      const live = new Set(this.events.keys());
      this.relationships = this.relationships.filter((r) => live.has(r.fromEventId) && live.has(r.toEventId));
      this.scheduleSave();
    }
    return n;
  }

  async removeBySource(dataSourceId: string) {
    let n = 0;
    for (const e of [...this.events.values()]) {
      if (e.sources.length && e.sources.every((s) => s.dataSourceId === dataSourceId)) {
        this.unindex(e);
        n++;
      }
    }
    if (n) this.scheduleSave();
    return n;
  }

  async addRelationship(rel: EventRelationship) {
    const exists = this.relationships.some(
      (r) =>
        r.type === rel.type &&
        ((r.fromEventId === rel.fromEventId && r.toEventId === rel.toEventId) ||
          (r.fromEventId === rel.toEventId && r.toEventId === rel.fromEventId)),
    );
    if (exists) return;
    this.relationships.push(rel);
    this.scheduleSave();
  }

  async relationshipsFor(eventId: string) {
    return this.relationships.filter((r) => r.fromEventId === eventId || r.toEventId === eventId);
  }

  async recordRun(run: IngestionRun) {
    const i = this.runs.findIndex((r) => r.id === run.id);
    if (i >= 0) this.runs[i] = run;
    else this.runs.push(run);
    const same = this.runs.filter((r) => r.dataSourceId === run.dataSourceId);
    if (same.length > RUNS_PER_SOURCE) {
      const drop = new Set(same.slice(0, same.length - RUNS_PER_SOURCE));
      this.runs = this.runs.filter((r) => !drop.has(r));
    }
    this.scheduleSave();
  }

  async listRuns(params: { dataSourceId?: string; limit?: number } = {}) {
    const list = params.dataSourceId ? this.runs.filter((r) => r.dataSourceId === params.dataSourceId) : this.runs;
    return list.slice(-(params.limit ?? 50)).reverse();
  }

  version() {
    return this._version;
  }
}
