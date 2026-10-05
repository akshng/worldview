# Event model

Defined with zod in `src/types/events.ts` (runtime validation + TypeScript types). TypeScript uses camelCase; the SQL schema (`src/lib/db/schema.sql`) uses the same names in snake_case.

## WorldEvent

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Internal id (`evt_…`) |
| `type` | category | `NEWS POLITICS CONFLICT PROTEST DISASTER EARTHQUAKE WEATHER FIRE FLOOD VOLCANO SPACE SCIENCE TECHNOLOGY BUSINESS MARKETS AVIATION MARITIME INFRASTRUCTURE OTHER` |
| `subtype` | string \| null | e.g. `tropical-cyclone`, `flash-flood`, `crime / public safety` |
| `title` | string | From the primary source (or generated deterministically from its fields) |
| `summary` | string | **verified_summary** — factual sentence(s) derived only from source data |
| `description` | string \| null | Longer factual text from the source (HTML stripped) |
| `latitude`, `longitude` | number | WGS84 |
| `geoPrecision` | `exact \| city \| region \| country \| approximate` | How precise the point is |
| `locationName` | string \| null | Source place text, or "62 km NE of City, Country", or ocean name |
| `country` / `countryName` / `region` | | ISO alpha-2 via reverse geocoding (Natural Earth); macro region (Europe, Middle East, …) |
| `city` | string \| null | When the source provides one |
| `timestamp` | ISO | When it happened / latest activity / scheduled time (may be in the future) |
| `resolvedAt` | ISO \| null | When the source says it ended/expires |
| `createdAt`, `updatedAt` | ISO | Ingestion bookkeeping |
| `importanceScore` | 0–100 | See below |
| `importanceFactors` | `{factor, points, detail}[]` | Explains the score |
| `confidenceScore` | 0–1 | Strongest assertion + corroboration × geo precision |
| `sourceCount` | int | Number of supporting source records |
| `sources` | `EventSource[]` | Primary (most authoritative) first |
| `entities` | `{type, name, code}[]` | Actors, organisations, countries, vehicles |
| `relatedEventIds` | string[] | Graph edges (also stored as `EventRelationship`) |
| `status` | `UNVERIFIED \| REPORTED \| PARTIALLY_CONFIRMED \| CONFIRMED \| RESOLVED` | Derived, see below |
| `metrics` | record | Type-specific scalars: `magnitude`, `depth_km`, `alert_level`, `frp_total_mw`, `wind_kts`, `num_articles`, … |
| `timeline` | `{at, kind, label, sourceId}[]` | `INITIAL_REPORT`, `OFFICIAL_CONFIRMATION`, `UPDATE`, `SOURCE_ADDED`, `RESOLVED` |
| `aiInterpretation` | `{text, provider, model, generatedAt}` \| null | **Separate from facts. Never merged into `summary`.** |
| `isSynthetic` | boolean | True only for demo-mode data |
| `rawData` | record | Trimmed upstream records keyed by source id (`/api/events/:id?raw=1`) |

## EventSource

`id` (`<dataSourceId>:<externalId>`), `dataSourceId`, `externalId`, `sourceName`, `sourceUrl` (http/https only), `title`, `titleIsDerived`, `publishedAt`, `retrievedAt`, `sourceType` (`OFFICIAL_AGENCY SCIENTIFIC SATELLITE NEWS_MEDIA NEWS_AGGREGATOR COMMUNITY_DATABASE SYNTHETIC`), `assertion`, `credibility` (`{basis}` — a factual description of the publisher, e.g. "U.S. federal scientific agency"; **never an invented rating**).

Sources are stored separately from the event (`event_sources` in SQL), so many sources can support one event.

## Status rules (`src/lib/events/status.ts`)

Independent publishers are counted by URL hostname (so two articles from the same outlet count once).

1. No sources, or only synthetic → `UNVERIFIED`
2. `resolvedAt` in the past → `RESOLVED`
3. Any `OFFICIAL_FINAL` source → `CONFIRMED`
4. Any `OFFICIAL_PRELIMINARY`/`MEASUREMENT` source → `PARTIALLY_CONFIRMED` if ≥2 independent publishers, else `REPORTED`
5. Any `SCHEDULED` source → `REPORTED`
6. Media reports from ≥2 independent publishers → `REPORTED`
7. Otherwise → `UNVERIFIED`

## Importance score (`src/lib/scoring/importance.ts`)

Deterministic and explained. Total = sum of five factors, clamped to 0–100.

| Factor | Max | Rule |
| --- | --- | --- |
| Severity | 60 | Category-specific (below) |
| Corroboration | 15 | `log2(independent publishers + 2 if an official final record) / 3` |
| Confirmation | 10 | CONFIRMED 10 · PARTIALLY_CONFIRMED 7 · REPORTED 5 · RESOLVED 4 · UNVERIFIED 0 |
| Scale | 10 | Population affected (source estimate) › felt reports › area, log-scaled; 0 when unknown |
| Recency | 5 | Linear decay over 72 h; scheduled/future events count as fresh |

Severity (0–1) by category:

- **Earthquake**: `(M − 2.5) / 5.5` (M5 ≈ 0.45, M7 ≈ 0.82, M8+ = 1); +0.15 if USGS tsunami flag; at least the alert level when present.
- **Alert levels** (GDACS / USGS PAGER): green 0.30 · yellow 0.55 · orange 0.70 · red 0.95.
- **Fire**: alert level if present, else `log10(total FRP MW) / 5`.
- **Weather**: alert level, else NWS severity (Extreme 0.75, Severe 0.5, Moderate 0.3) +0.1 if Immediate; wind speed for cyclones.
- **Flood / Volcano / Disaster**: alert level, else 0.35 / 0.45 / 0.35.
- **News-derived (conflict, protest, politics, news …)**: base (conflict 0.25, protest 0.18, other 0.1) + |negative Goldstein|/10 × 0.25 + log-scaled article count × 0.3.
- **Space**: launch 0.35, crewed launch 0.75.

Bands: 0–20 Minor · 21–40 Low · 41–60 Moderate · 61–80 High · 81–100 Critical. Examples (USGS-reviewed, fresh): M4 → 39, M5 → 50, M6 → 61, M7 → 72, M8 → 83.

Scores are recomputed every 5 minutes (recency decays, statuses resolve). AI may later propose adjustments, but the deterministic score remains the baseline.

## Deduplication (`src/lib/deduplication/similarity.ts`)

For each new candidate the pipeline:

1. **Upserts** if the same source record (`dataSourceId:externalId`) was seen before (updates are recorded on the timeline — e.g. magnitude revisions, official review).
2. Otherwise looks up **nearby events of the same type** within the category's radius and time window and computes a match score:

```
score = geo (1 − d/radius) · w_geo + time (1 − Δt/window) · w_time
      + title similarity (token Jaccard) · w_text + entity overlap · 0.15
```

| Category | Radius | Window | Min text similarity | Extra |
| --- | --- | --- | --- | --- |
| Earthquake | 100 km | 3 min | — | magnitudes within 0.7 |
| Weather | 350 km | 72 h | 0.34 | |
| Flood | 250 km | 96 h | 0.2 | |
| Volcano | 40 km | 21 d | — | |
| Fire | 25 km | 48 h | 0.2 | |
| Disaster | 250 km | 96 h | 0.3 | |
| Space | 50 km | 6 h | 0.5 | |
| News-like (default) | 30 km | 18 h | 0.3 | up to 800 km when headlines are ≥ 0.8 similar and specific (≥ 6 words) — syndicated copies geocoded to different cities |

Title similarity uses lightly stemmed tokens (5-character prefixes, so "Russian" ≈ "Russia") and the better of Jaccard and a discounted overlap coefficient, so a short headline contained in a longer one still matches. Health events additionally never merge when they name different diseases.

A match ≥ 0.55 merges the candidate into the existing event as an additional source. Rules that keep merges honest:

- Two records from the **same authoritative feed** are never merged (two USGS quakes are two quakes). Only aggregators (`mergeWithinSource`, i.e. GDELT) can self-merge.
- For news-derived events, text similarity compares the **event label + article headlines** rather than the generated title (which is mostly the place name), so unrelated incidents in the same city stay separate.
- The same article URL is never attached twice.
- Records that **supersede** earlier ones (e.g. NWS alert updates referencing the previous message) update the original event in place.
- The most authoritative source becomes primary and supplies title/coordinates/metrics; others only fill gaps.

## Relationships (event graph)

`EventRelationship { fromEventId, toEventId, type, basis, createdAt }` with types `SAME_STORY`, `CAUSED_BY`, `TRIGGERED`, `NEARBY`, `POSSIBLY_RELATED`. V1 creates `POSSIBLY_RELATED` edges by rule for hazard pairs within 300 km / 48 h (earthquake↔tsunami/weather bulletins, volcano↔aviation, wildfire reports↔satellite fire clusters, …), always with a `basis` string. The details panel also lists nearby events, labelled "proximity only". News categories are not auto-linked by proximity.

## Fact vs interpretation

- `summary` / `description` / `metrics` / `sources` = facts from sources.
- `aiInterpretation` = optional model output, generated on request, stored with provider/model/time, displayed in a separate purple box headed "AI interpretation — not verified fact".
- AI is never used to create events, set status, or write to factual fields.
