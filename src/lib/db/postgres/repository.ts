/**
 * EventRepository on PostgreSQL (server or embedded PGlite).
 * Spatial lookups use an indexed lat/lon bounding box + exact haversine filter,
 * so no PostGIS extension is required (it can be added later for GIST indexes).
 */
import type { EventRelationship, WorldEvent } from "@/types/events";
import { searchHaystack, searchTerms, type EventQuery } from "@/lib/events/query";
import { haversineKm, type BBox } from "@/lib/geo/math";
import type { EventRepository, IngestionRun } from "../types";
import type { Queryable, SqlClient } from "./client";
import { migrate } from "./migrations";

const MAX_RUNS = 500;

type Doc = { doc: WorldEvent };

export class PostgresEventRepository implements EventRepository {
  readonly kind: string;
  private _version = 0;
  private ready: Promise<void> | null = null;
  private runWrites = 0;

  constructor(private readonly db: SqlClient) {
    this.kind = db.kind;
  }

  init() {
    if (!this.ready) this.ready = migrate(this.db);
    return this.ready;
  }

  version() {
    return this._version;
  }

  private bump() {
    this._version++;
  }

  async get(id: string) {
    return (await this.db.query<Doc>(`SELECT doc FROM events WHERE id = $1`, [id])).rows[0]?.doc ?? null;
  }

  async getMany(ids: string[]) {
    if (!ids.length) return [];
    return (await this.db.query<Doc>(`SELECT doc FROM events WHERE id = ANY($1::text[])`, [ids])).rows.map((r) => r.doc);
  }

  async findBySourceRecord(sourceRecordId: string) {
    const r = await this.db.query<Doc>(
      `SELECT e.doc FROM event_sources s JOIN events e ON e.id = s.event_id WHERE s.id = $1`,
      [sourceRecordId],
    );
    return r.rows[0]?.doc ?? null;
  }

  async findNear({ lat, lon, radiusKm, fromMs, toMs, type }: Parameters<EventRepository["findNear"]>[0]) {
    const dLat = radiusKm / 111;
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
    const dLon = radiusKm / (111 * cosLat);
    const params: unknown[] = [lat - dLat, lat + dLat, new Date(fromMs).toISOString(), new Date(toMs).toISOString()];
    let lonSql = "";
    if (dLon < 180) {
      const w = lon - dLon, e = lon + dLon;
      if (w < -180) lonSql = ` AND (longitude >= ${w + 360} OR longitude <= ${e})`;
      else if (e > 180) lonSql = ` AND (longitude >= ${w} OR longitude <= ${e - 360})`;
      else lonSql = ` AND longitude BETWEEN ${w} AND ${e}`;
    }
    let typeSql = "";
    if (type) {
      params.push(type);
      typeSql = ` AND type = $${params.length}`;
    }
    const rows = await this.db.query<Doc>(
      `SELECT doc FROM events WHERE latitude BETWEEN $1 AND $2 AND ts BETWEEN $3 AND $4${lonSql}${typeSql}`,
      params,
    );
    return rows.rows.map((r) => r.doc).filter((e) => haversineKm(lat, lon, e.latitude, e.longitude) <= radiusKm);
  }

  private async write(tx: Queryable, e: WorldEvent) {
    await tx.query(
      `INSERT INTO events (id, type, status, latitude, longitude, country, region, ts, updated_at, importance, is_synthetic, search_text, doc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type, status = EXCLUDED.status, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         country = EXCLUDED.country, region = EXCLUDED.region, ts = EXCLUDED.ts, updated_at = EXCLUDED.updated_at,
         importance = EXCLUDED.importance, is_synthetic = EXCLUDED.is_synthetic, search_text = EXCLUDED.search_text, doc = EXCLUDED.doc`,
      [e.id, e.type, e.status, e.latitude, e.longitude, e.country, e.region, e.timestamp, e.updatedAt, e.importanceScore, e.isSynthetic, searchHaystack(e), JSON.stringify(e)],
    );
    const ids = e.sources.map((s) => s.id);
    await tx.query(`DELETE FROM event_sources WHERE event_id = $1 AND NOT (id = ANY($2::text[]))`, [e.id, ids]);
    if (ids.length) {
      await tx.query(
        `INSERT INTO event_sources (id, event_id) SELECT unnest($1::text[]), $2
         ON CONFLICT (id) DO UPDATE SET event_id = EXCLUDED.event_id`,
        [ids, e.id],
      );
    }
  }

  async save(event: WorldEvent) {
    await this.db.transaction((tx) => this.write(tx, event));
    this.bump();
  }

  async saveMany(events: WorldEvent[]) {
    if (!events.length) return;
    await this.db.transaction(async (tx) => {
      for (const e of events) await this.write(tx, e);
    });
    this.bump();
  }

  /** Translate an EventQuery into SQL. Mirrors `matchesQuery` exactly. */
  private where(q: Partial<EventQuery>, params: unknown[]): string {
    const c: string[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.from) c.push(`ts >= ${add(q.from)}`);
    if (q.to) c.push(`ts <= ${add(q.to)}`);
    if (q.type?.length) c.push(`type = ANY(${add(q.type)}::text[])`);
    if (q.status?.length) c.push(`status = ANY(${add(q.status)}::text[])`);
    if (q.country) c.push(`country = ${add(q.country)}`);
    if (q.importance !== undefined) c.push(`importance >= ${add(q.importance)}`);
    if (q.synthetic === "exclude") c.push(`NOT is_synthetic`);
    if (q.synthetic === "only") c.push(`is_synthetic`);
    if (q.bbox) {
      const [w, s, e, n] = q.bbox as BBox;
      c.push(`latitude BETWEEN ${add(s)} AND ${add(n)}`);
      c.push(w <= e ? `longitude BETWEEN ${add(w)} AND ${add(e)}` : `(longitude >= ${add(w)} OR longitude <= ${add(e)})`);
    }
    if (q.q) {
      for (const term of searchTerms(q.q)) c.push(`search_text LIKE ${add(`%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}`);
    }
    return c.length ? `WHERE ${c.join(" AND ")}` : "";
  }

  async scan(q: Partial<EventQuery>) {
    const params: unknown[] = [];
    return (await this.db.query<Doc>(`SELECT doc FROM events ${this.where(q, params)}`, params)).rows.map((r) => r.doc);
  }

  async query(q: Partial<EventQuery>) {
    const params: unknown[] = [];
    const where = this.where(q, params);
    params.push(new Date().toISOString());
    const now = `$${params.length}::timestamptz`;
    // Recency = distance from now (upcoming events rank like past ones); see recencyKey().
    const recency = `(CASE WHEN ts <= ${now} THEN ts ELSE ${now} - (ts - ${now}) END)`;
    const order = q.sort === "importance" ? `importance DESC, ${recency} DESC` : `${recency} DESC, importance DESC`;
    params.push(q.limit ?? 500, q.offset ?? 0);
    const rows = await this.db.query<Doc & { total: string | number }>(
      `SELECT doc, count(*) OVER () AS total FROM events ${where} ORDER BY ${order}, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    let total = Number(rows.rows[0]?.total ?? 0);
    if (!rows.rows.length && (q.offset ?? 0) > 0) {
      const p2: unknown[] = [];
      total = Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM events ${this.where(q, p2)}`, p2)).rows[0].n);
    }
    return { events: rows.rows.map((r) => r.doc), total };
  }

  async count() {
    return Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM events`)).rows[0].n);
  }

  async prune(beforeMs: number) {
    const r = await this.db.query<{ id: string }>(`DELETE FROM events WHERE GREATEST(ts, COALESCE((doc->>'lastEvidenceAt')::timestamptz, updated_at)) < $1 RETURNING id`, [new Date(beforeMs).toISOString()]);
    if (r.rows.length) this.bump();
    return r.rows.length;
  }

  async removeBySource(dataSourceId: string) {
    const r = await this.db.query<{ id: string }>(
      `DELETE FROM events e WHERE jsonb_array_length(e.doc->'sources') > 0 AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(e.doc->'sources') s WHERE s->>'dataSourceId' <> $1) RETURNING id`,
      [dataSourceId],
    );
    if (r.rows.length) this.bump();
    return r.rows.length;
  }

  async addRelationship(rel: EventRelationship) {
    await this.db.query(
      `INSERT INTO event_relationships (from_event_id, to_event_id, type, basis, created_at)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM event_relationships WHERE type = $3 AND
         ((from_event_id = $1 AND to_event_id = $2) OR (from_event_id = $2 AND to_event_id = $1)))
         AND EXISTS (SELECT 1 FROM events WHERE id = $1) AND EXISTS (SELECT 1 FROM events WHERE id = $2)
       ON CONFLICT DO NOTHING`,
      [rel.fromEventId, rel.toEventId, rel.type, rel.basis, rel.createdAt],
    );
  }

  async relationshipsFor(eventId: string) {
    const r = await this.db.query<{ from_event_id: string; to_event_id: string; type: EventRelationship["type"]; basis: string; created_at: Date | string }>(
      `SELECT * FROM event_relationships WHERE from_event_id = $1 OR to_event_id = $1`,
      [eventId],
    );
    return r.rows.map((x) => ({
      fromEventId: x.from_event_id,
      toEventId: x.to_event_id,
      type: x.type,
      basis: x.basis,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  async recordRun(run: IngestionRun) {
    await this.db.query(
      `INSERT INTO ingestion_runs (id, data_source_id, started_at, doc) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`,
      [run.id, run.dataSourceId, run.startedAt, JSON.stringify(run)],
    );
    if (++this.runWrites % 50 === 0) {
      await this.db.query(`DELETE FROM ingestion_runs WHERE id NOT IN (SELECT id FROM ingestion_runs ORDER BY started_at DESC LIMIT ${MAX_RUNS})`);
    }
  }

  async listRuns(params: { dataSourceId?: string; limit?: number } = {}) {
    const limit = params.limit ?? 50;
    const r = params.dataSourceId
      ? await this.db.query<{ doc: IngestionRun }>(`SELECT doc FROM ingestion_runs WHERE data_source_id = $1 ORDER BY started_at DESC LIMIT $2`, [params.dataSourceId, limit])
      : await this.db.query<{ doc: IngestionRun }>(`SELECT doc FROM ingestion_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x) => x.doc);
  }

  async close() {
    await this.db.close();
  }
}
