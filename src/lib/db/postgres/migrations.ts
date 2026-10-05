/**
 * Schema migrations for the SQL repository, applied automatically on start.
 * Mirrors src/lib/db/schema.sql (which documents the full schema incl. future tables).
 *
 * Events are stored as a JSONB document (the validated WorldEvent) plus
 * indexed columns for every filter the API supports. This keeps reads exact
 * (no lossy mapping) while queries stay index-backed.
 */
export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE IF NOT EXISTS wv_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT NOT NULL,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    country       TEXT,
    region        TEXT,
    ts            TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    importance    SMALLINT NOT NULL,
    is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE,
    search_text   TEXT NOT NULL,
    doc           JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts DESC);
  CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events (type, ts DESC);
  CREATE INDEX IF NOT EXISTS events_country_ts_idx ON events (country, ts DESC);
  CREATE INDEX IF NOT EXISTS events_importance_idx ON events (importance DESC);
  CREATE INDEX IF NOT EXISTS events_latlon_idx ON events (latitude, longitude);

  CREATE TABLE IF NOT EXISTS event_sources (
    id        TEXT PRIMARY KEY,            -- '<dataSourceId>:<externalId>'
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS event_sources_event_idx ON event_sources (event_id);

  CREATE TABLE IF NOT EXISTS event_relationships (
    from_event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    to_event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    basis         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (from_event_id, to_event_id, type)
  );
  CREATE INDEX IF NOT EXISTS event_relationships_to_idx ON event_relationships (to_event_id);

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id              TEXT PRIMARY KEY,
    data_source_id  TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    doc             JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx ON ingestion_runs (data_source_id, started_at DESC);
  `,
];

export async function migrate(db: { exec(sql: string): Promise<void>; query<T>(t: string, p?: unknown[]): Promise<{ rows: T[] }> }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS wv_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = (await db.query<{ value: string }>(`SELECT value FROM wv_meta WHERE key = 'schema_version'`)).rows[0];
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    await db.exec(MIGRATIONS[version]);
    version++;
    await db.query(
      `INSERT INTO wv_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(version)],
    );
  }
}
