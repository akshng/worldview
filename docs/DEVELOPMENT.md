# Development

## Setup

```bash
npm install
```

`postinstall` copies the MapLibre worker into `public/vendor/maplibre/` (git-ignored). `predev`/`prebuild` repeat it, so you never need to do it by hand.

```bash
npm run dev
```

Open http://localhost:3000. The first API request starts the ingestion scheduler; sources fetch within ~10 s (staggered).

## Useful commands

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

Trigger one source manually (localhost only, or with `ADMIN_TOKEN`):

```bash
curl -X POST http://localhost:3000/api/ingest/usgs
```

Inspect source health and recent runs:

```bash
curl -s http://localhost:3000/api/sources
```

## Data modes

- **Live** (default): real public feeds only. Store: `.data/live-store.json`.
- **Demo**: `WORLDVIEW_DATA_MODE=demo` in `.env.local`. Only the synthetic generator runs; every event is titled `[SIMULATED]`, flagged `isSynthetic`, has no source URL, shows a "Simulated" badge, and a yellow "Demo mode" banner is shown app-wide. Store: `.data/demo-store.json`. AI interpretation is disabled for simulated events.

If upstream feeds are unreachable in live mode, the UI shows "No data available" and the failing sources show `ERROR` in Settings → Data sources — it never substitutes fake data.

To reset local data, stop the server and delete `.data/`.

## Developer mode

Settings → General → Developer mode adds: recent ingestion runs (received/new/updated/dedup/duration), event ids, and a link to each event's raw upstream records.

## Testing

`tests/` (vitest, Node environment):

| File | Covers |
| --- | --- |
| `events.test.ts` | Validation, normalisation, event creation, merging, resolution |
| `status-scoring.test.ts` | Status rules, independent-publisher counting, importance scoring and bands |
| `dedup.test.ts` | Similarity, cross-source merges, same-feed separation, unrelated-story separation |
| `filters.test.ts` | Geo math (antimeridian bbox, polygons), query/date filters, client windows, API query validation, ocean names |
| `connectors.test.ts` | Every parser against fixtures (USGS, GDELT, FIRMS, NWS, GDACS, EONET, demo) |
| `pipeline.test.ts` | Gazetteer reverse geocoding, end-to-end ingestion with dedup, antimeridian lookups |
| `search.test.ts` | Intent parsing, location search, solar terminator |
| `repository.test.ts` | Repository contract run against **both** the memory store and Postgres (PGlite) |
| `briefing.test.ts` | NEW/DEVELOPING/ONGOING/RESOLVED classification, ranking, day comparison |
| `geo-accuracy.test.ts` | Headline place checks, US namesake towns, offshore countries, interior points, hulls |
| `new-sources.test.ts` | IODA, FAA, tsunami, WHO, SEC parsers; airport and address lookups |
| `finance.test.ts` | Market exposure rules, mover diversity, Treasury CSV parsing |
| `ai.test.ts` | AI command handling with a mock model: schema validation, gazetteer-only place resolution, narrative cache |

Parsers are pure functions, so new connectors are tested without network access.

## Conventions

- Server-only modules import `"server-only"`; never import `src/lib/env.ts` or `src/lib/server/*` from components.
- Upstream text → `plainText()`; upstream URLs → `safeUrl()`; render as React text only.
- Keep facts in `summary`/`metrics`; any model output goes to `aiInterpretation`.
- New UI colours/typography come from tokens in `src/app/globals.css` (`--bg`, `--panel`, `--accent`, `.meta`, `.glass`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Globe area is blank | Check the browser console for WebGL errors; ensure `public/vendor/maplibre/maplibre-gl-worker.mjs` exists (`node scripts/copy-maplibre-worker.mjs`) |
| A source shows `ERROR` | Read the error in Settings → Data sources. Other sources keep working; the scheduler backs off and retries |
| No events after start | Wait ~30 s for the first runs; check `curl -s localhost:3000/api/sources` |
| Launch Library 429 | Free tier is 15 req/h; the scheduler waits out intervals across restarts — avoid repeated "Run now" |
| Rebuild country/city data | `npm run geo:build` (downloads Natural Earth) |

## Storage options

| `DATABASE_URL` | Storage | Notes |
| --- | --- | --- |
| unset | In-memory + `.data/<mode>-store.json` | Fastest; single process |
| `pglite` | Embedded Postgres in `.data/pglite-<mode>/` | Real SQL, nothing to install, single process |
| `postgres://user:pass@host:5432/db` | PostgreSQL server, schema `worldview_<mode>` | Durable shared storage; tables created automatically. Run one ingesting server process per database |

Schema: `src/lib/db/postgres/migrations.ts` (applied on start) — documented with future tables in `src/lib/db/schema.sql`. Switching storage does not migrate existing data; the new store fills from the feeds within minutes.
