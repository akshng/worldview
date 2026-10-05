/**
 * In-memory EventRepository with debounced JSON snapshot persistence.
 *
 * Good for a single local process (V1). Uses a 1° grid index for spatial
 * candidate lookups. Swap for a PostgreSQL/PostGIS implementation of
 * `EventRepository` when multi-process or larger volumes are needed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventRelationship, WorldEvent } from "@/types/events";
import { matchesQuery, sortEvents, type EventQuery } from "@/lib/events/query";
import { gridKey, haversineKm } from "@/lib/geo/math";
import type { EventRepository, IngestionRun } from "./types";

const CELL = 1; // degrees
const SNAPSHOT_VERSION = 1;
const MAX_RUNS = 500;

interface Snapshot {
  version: number;
  savedAt: string;
  events: WorldEvent[];
  relationships: EventRelationship[];
  runs: IngestionRun[];
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
      if (snap.version !== SNAPSHOT_VERSION) return;
      for (const e of snap.events) this.index(e);
      this.relationships = snap.relationships ?? [];
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
    }, 5000);
    this.saveTimer.unref?.();
  }

  async flush() {
    if (!this.snapshotFile) return;
    const snap: Snapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      events: [...this.events.values()],
      relationships: this.relationships,
      runs: this.runs,
    };
    try {
      await fs.mkdir(path.dirname(this.snapshotFile), { recursive: true });
      const tmp = `${this.snapshotFile}.tmp`;
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
      const latest = Math.max(Date.parse(e.timestamp), Date.parse(e.updatedAt));
      if (latest < beforeMs) {
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
    if (this.runs.length > MAX_RUNS) this.runs.splice(0, this.runs.length - MAX_RUNS);
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
