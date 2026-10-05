# Data sources

All V1 connectors use official or well-established public structured feeds. No web scraping. Each connector lives in `src/data-sources/<id>/` and is registered in `src/data-sources/registry.ts`.

| ID | Source | What becomes an event | Refresh | Key | Source type / assertion |
| --- | --- | --- | --- | --- | --- |
| `usgs` | [USGS GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) `2.5_week` | Each natural earthquake M2.5+ (blasts/explosions and deleted solutions skipped) | 2 min | — | Official agency / `OFFICIAL_FINAL` if reviewed, else `OFFICIAL_PRELIMINARY` |
| `gdacs` | [GDACS](https://www.gdacs.org/) `EVENTS4APP` list | Each EQ/TC/FL/VO/DR/WF event (forecast floods flagged `-forecast`) | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `nws` | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) active alerts, severity Severe/Extreme | Each alert with a warning polygon (zone-only alerts skipped, counted in the run log) | 5 min | — (User-Agent required) | Official agency / `OFFICIAL_PRELIMINARY` |
| `eonet` | [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) open events (20 days) | Each event at its latest geometry; upstream source (JTWC, InciWeb, …) linked | 20 min | — | Scientific / `OFFICIAL_PRELIMINARY` |
| `nasa-firms` | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) VIIRS S-NPP NRT, 24 h | Connected clusters of ≥20 hotspots or ≥400 MW total FRP (0.1° grid, 8-neighbour), one per UTC day + 0.5° cell | 30 min | optional `NASA_FIRMS_MAP_KEY` | Satellite / `MEASUREMENT` |
| `gdelt` | [GDELT 2.0](https://www.gdeltproject.org/) event export (15-min files) | Root events with city/ADM1 geocoding, filtered by CAMEO class and article thresholds, collapsed per article/place, then deduplicated across articles | 15 min | — | News media / `MEDIA_REPORT` |
| `space` | [Launch Library 2](https://thespacedevs.com/llapi) upcoming + previous | Launches within ±7 days at the launch pad | 30 min | — (15 req/h free tier) | Community database / `SCHEDULED` |
| `demo` | Built-in generator | Simulated events — **demo mode only** | 5 min | — | Synthetic / `SYNTHETIC` |

## Live layers (`src/layers/`)

Live layers are continuously changing observations visualised in map modes. They are **not events**: they never enter the event store, scoring or deduplication. Each is fetched on demand through `/api/layers/:id` and cached server-side for its TTL, so upstream quotas are only used while someone is looking, and every client shares one cached copy. If an upstream fetch fails, the last good snapshot is served with `stale: true` (shown in the legend).

| ID | Source | Mode | Cache | Key | Notes |
| --- | --- | --- | --- | --- | --- |
| `weather-radar` | [RainViewer](https://www.rainviewer.com/api.html) weather-maps index + tiles | Weather | 5 min | — | 13 past frames (2 h) + nowcast; coverage only where national radar networks share data; attribution required |
| `aviation` | [OpenSky Network](https://opensky-network.org/) `/states/all` | Aviation | 20 min | optional `OPENSKY_CLIENT_ID/SECRET` | Anonymous quota is 400 credits/day; a global snapshot costs 4, so the 20-min cache keeps continuous use under ~290/day. Positions older than 2 min are dropped. Non-commercial use terms apply |
| `maritime` | [AISStream.io](https://aisstream.io/) websocket | Maritime | 1 min | `AISSTREAM_API_KEY` (free) | A websocket stays open while the mode is used (closed after 10 idle minutes); latest position per vessel, last 30 min; terrestrial AIS is sparse in open ocean |

Adding a layer: create `src/layers/<id>/` with a `LiveLayerProvider` (`load()` returns a snapshot), register it in `src/layers/registry.ts`, add a mode in `src/lib/map-modes.ts` and its map layers in `src/components/globe/layers.ts`.

## Caveats you should know

- **GDELT is machine-coded.** It infers event type and location from article text and makes mistakes (e.g. animal attacks coded as assaults). Mitigations: root events only; country-centroid geocodes dropped; single-source, single-article violence dropped; actor type codes (MIL/REB/INS… vs COP/CRM/JUD) route crime stories to **News / crime & public safety** instead of Conflict; GDELT's FIPS country codes are ignored in favour of our own reverse geocoding. Titles are taken from the article URL slug (marked "derived from URL") because GDELT does not publish headlines. GDELT events start **Unverified** and become **Reported** only when ≥2 independent publishers are merged into the event.
- **FIRMS hotspots are not all wildfires.** Agricultural burning, gas flares and industrial heat appear too; every summary says so.
- **NWS alert updates** reference the alerts they replace; the pipeline uses this (`supersedes`) to update the original event instead of creating duplicates. Cancellations mark the event resolved.
- **GDELT** produces one candidate per article (not per coded place), and articles from sports/entertainment sections are skipped because their violent vocabulary is figurative.
- **NWS covers the United States only.** It is the weather provider in V1 behind a connector-shaped abstraction; a global weather provider can be added as another connector. GDACS and EONET cover global cyclones/storms.
- **Launch Library 2 is community-maintained.** Launches are labelled with its status; "crewed" is derived from the mission type field.
- **Overlap is expected and handled**: USGS ↔ GDACS earthquakes and GDACS ↔ EONET storms/volcanoes are merged by deduplication; EONET wildfires ↔ FIRMS clusters are linked as related events (not merged).

## Rate limits and etiquette

Intervals are set per connector (`refreshIntervalMs`). On failure the scheduler backs off exponentially (up to 8× the interval). On restart it reads the persisted run log and waits out the remainder of each interval, so frequent dev restarts don't exceed upstream limits. The "Run now" button in Settings triggers a single run — use it sparingly for rate-limited sources.

## Adding a new data source

Example: an `example` source with a JSON API.

1. **Create the folder**

```
src/data-sources/example/
  types.ts    // raw upstream shapes
  client.ts   // fetch only
  parser.ts   // pure transform → EventCandidateInput[]
  index.ts    // DataSourceConnector
```

2. **`client.ts`** — use the shared helper (adds User-Agent, timeout signal, status errors):

```ts
import { httpGet, type FetchContext } from "../types";
import type { ExampleResponse } from "./types";

export async function fetchExample(ctx: FetchContext): Promise<ExampleResponse> {
  const key = ctx.env.EXAMPLE_API_KEY; // only if the source needs one
  const res = await httpGet(`https://api.example.org/events?key=${encodeURIComponent(key ?? "")}`, ctx);
  return (await res.json()) as ExampleResponse;
}
```

3. **`parser.ts`** — pure and deterministic; never invent fields. Use `plainText()` for upstream text and `safeUrl()` for links:

```ts
import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { ExampleResponse } from "./types";

export function parseExample(raw: ExampleResponse, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const item of raw.items) {
    if (item.lat == null || item.lon == null) { skipped++; continue; }
    candidates.push({
      type: "INFRASTRUCTURE",
      subtype: "power-outage",
      title: plainText(item.title, 200),
      summary: `Example Agency reports ${plainText(item.summary, 400)}`, // facts from the source only
      latitude: item.lat,
      longitude: item.lon,
      geoPrecision: "city",
      locationName: item.place ?? null,
      timestamp: new Date(item.time).toISOString(),
      metrics: { customers_affected: item.customers ?? null },
      source: {
        id: `example:${item.id}`,
        dataSourceId: "example",
        externalId: String(item.id),
        sourceName: "Example Agency",
        sourceUrl: safeUrl(item.url),
        title: item.title ?? null,
        titleIsDerived: false,
        publishedAt: new Date(item.time).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Regional utility regulator" }, // factual basis only, never a made-up rating
      },
      rawData: item,
    });
  }
  return { candidates, skipped };
}
```

4. **`index.ts`**

```ts
import type { DataSourceConnector } from "../types";
import { fetchExample } from "./client";
import { parseExample } from "./parser";
import type { ExampleResponse } from "./types";

export const exampleConnector: DataSourceConnector<ExampleResponse> = {
  id: "example",
  name: "Example outages",
  description: "Power outages reported by Example Agency.",
  homepage: "https://example.org",
  attribution: "Example Agency — CC BY 4.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["INFRASTRUCTURE"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  // Optional: report missing keys instead of failing every run
  checkConfiguration: (env) => (env.EXAMPLE_API_KEY ? null : "EXAMPLE_API_KEY is not set"),
  fetch: fetchExample,
  parse: parseExample,
};
```

5. **Register** it in `src/data-sources/registry.ts`, add `EXAMPLE_API_KEY=` to `.env.example` only if a key is genuinely required, and add a parser test with a small fixture to `tests/connectors.test.ts`.

That's all — the pipeline handles validation, geocoding, deduplication, scoring, storage, health reporting and live updates.

### Choosing `assertion`

| Assertion | Use when | Effect on status |
| --- | --- | --- |
| `OFFICIAL_FINAL` | Authoritative, reviewed record | `CONFIRMED` |
| `OFFICIAL_PRELIMINARY` | Authoritative but automatic/alert/forecast | `REPORTED` (or `PARTIALLY_CONFIRMED` with corroboration) |
| `MEASUREMENT` | Instrument detection | as above |
| `SCHEDULED` | Planned future event / launch database | `REPORTED` |
| `MEDIA_REPORT` | A news article | `UNVERIFIED` until ≥2 independent publishers |
| `SYNTHETIC` | Demo data | always `UNVERIFIED`, confidence 0 |

### Dedup settings

If your events may duplicate another source's, tune `DEDUP_RULES` for the category in `src/lib/deduplication/similarity.ts` (radius, time window, text-similarity threshold, compatibility check). Set `mergeWithinSource: true` only for aggregators whose separate records can describe the same event (like GDELT articles).
