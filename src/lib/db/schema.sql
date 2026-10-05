-- WorldView *target* normalised schema for PostgreSQL 15+ / PostGIS 3+.
--
-- The schema the app actually runs today (DATABASE_URL=pglite or postgres://…)
-- is created automatically by src/lib/db/postgres/migrations.ts: events stored
-- as validated JSONB documents plus indexed filter columns, event_sources,
-- event_relationships and ingestion_runs. This file is the direction of travel
-- (normalised sources/entities/locations, PostGIS geography + GIST indexes,
-- and the future user-facing tables) and should be adopted via new migrations.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Registered connectors (mirrors src/data-sources/registry.ts)
CREATE TABLE data_sources (
  id                  TEXT PRIMARY KEY,               -- 'usgs', 'gdelt', …
  name                TEXT NOT NULL,
  source_type         TEXT NOT NULL,
  homepage            TEXT,
  refresh_interval_ms INTEGER NOT NULL,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE events (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL,
  subtype            TEXT,
  title              TEXT NOT NULL,
  summary            TEXT NOT NULL,                  -- verified_summary (facts only)
  description        TEXT,
  geom               GEOGRAPHY(POINT, 4326) NOT NULL,
  geo_precision      TEXT NOT NULL,
  location_name      TEXT,
  country            CHAR(2),
  country_name       TEXT,
  region             TEXT,
  city               TEXT,
  timestamp          TIMESTAMPTZ NOT NULL,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  importance_score   SMALLINT NOT NULL CHECK (importance_score BETWEEN 0 AND 100),
  importance_factors JSONB NOT NULL DEFAULT '[]',
  confidence_score   REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  source_count       INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('UNVERIFIED','REPORTED','PARTIALLY_CONFIRMED','CONFIRMED','RESOLVED')),
  metrics            JSONB NOT NULL DEFAULT '{}',
  timeline           JSONB NOT NULL DEFAULT '[]',
  ai_interpretation  JSONB,                          -- {text, provider, model, generated_at}; never merged into summary
  is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX events_geom_idx       ON events USING GIST (geom);
CREATE INDEX events_timestamp_idx  ON events (timestamp DESC);
CREATE INDEX events_type_time_idx  ON events (type, timestamp DESC);
CREATE INDEX events_country_idx    ON events (country, timestamp DESC);
CREATE INDEX events_importance_idx ON events (importance_score DESC);

-- Publishers / feeds (one row per publisher, e.g. reuters.com or USGS)
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,                     -- normalised publisher key
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  homepage     TEXT,
  credibility  JSONB                                 -- factual basis only, never an invented rating
);

-- Individual source records supporting an event (articles, alerts, detections)
CREATE TABLE event_sources (
  id             TEXT PRIMARY KEY,                   -- '<data_source_id>:<external_id>'
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id),
  source_id      TEXT REFERENCES sources(id),
  external_id    TEXT NOT NULL,
  source_name    TEXT NOT NULL,
  source_url     TEXT CHECK (source_url ~ '^https?://'),
  title          TEXT,
  title_is_derived BOOLEAN NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  retrieved_at   TIMESTAMPTZ NOT NULL,
  assertion      TEXT NOT NULL,
  raw_data       JSONB,
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX event_sources_event_idx ON event_sources (event_id);

CREATE TABLE locations (
  id        BIGSERIAL PRIMARY KEY,
  kind      TEXT NOT NULL,                           -- country | admin1 | city | region
  code      TEXT,
  name      TEXT NOT NULL,
  country   CHAR(2),
  geom      GEOGRAPHY(GEOMETRY, 4326)
);
CREATE INDEX locations_geom_idx ON locations USING GIST (geom);

CREATE TABLE entities (
  id    BIGSERIAL PRIMARY KEY,
  type  TEXT NOT NULL,
  name  TEXT NOT NULL,
  code  TEXT,
  UNIQUE (type, name)
);

CREATE TABLE event_entities (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role      TEXT,
  PRIMARY KEY (event_id, entity_id)
);

-- Event graph: earthquake → tsunami warning → infrastructure disruption …
CREATE TABLE event_relationships (
  from_event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  to_event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                       -- SAME_STORY | CAUSED_BY | TRIGGERED | NEARBY | POSSIBLY_RELATED
  basis         TEXT NOT NULL,                       -- 'rule:proximity(...)', 'ai:model', 'manual'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_event_id, to_event_id, type)
);

CREATE TABLE ingestion_runs (
  id                    TEXT PRIMARY KEY,
  data_source_id        TEXT NOT NULL REFERENCES data_sources(id),
  started_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  success               BOOLEAN NOT NULL,
  records_received      INTEGER NOT NULL DEFAULT 0,
  records_created       INTEGER NOT NULL DEFAULT 0,
  records_updated       INTEGER NOT NULL DEFAULT 0,
  records_deduplicated  INTEGER NOT NULL DEFAULT 0,
  records_skipped       INTEGER NOT NULL DEFAULT 0,
  records_invalid       INTEGER NOT NULL DEFAULT 0,
  errors                JSONB NOT NULL DEFAULT '[]',
  duration_ms           INTEGER
);
CREATE INDEX ingestion_runs_source_idx ON ingestion_runs (data_source_id, started_at DESC);

-- ---- Future (not used in V1) ---------------------------------------------
CREATE TABLE users (
  id         UUID PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE saved_locations (
  id      BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  geom    GEOGRAPHY(GEOMETRY, 4326) NOT NULL
);
CREATE TABLE saved_topics (
  id      BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query   TEXT NOT NULL
);
CREATE TABLE alerts (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule      JSONB NOT NULL,
  enabled   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE daily_briefings (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  structure    JSONB NOT NULL,                       -- DailyBriefing (event-referenced facts)
  ai_narrative TEXT,                                 -- labelled interpretation
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
