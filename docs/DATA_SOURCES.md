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
| `gdelt-gkg` | [GDELT GKG](https://www.gdeltproject.org/) 15-minute files | News articles with their **real headlines**, classified only when a GDELT theme **and** headline wording agree, located only where the headline and the article's geocoded mentions agree (or the headline names a place with a locative cue); multi-outlet stories rank first; ≤150 per run; merged across outlets by deduplication | 15 min | — | News media / `MEDIA_REPORT` |
| `meteoalarm` | [MeteoAlarm](https://meteoalarm.org/) feeds for 38 countries | Active orange/red warnings; placed on a named city, else a named state/province/region (Natural Earth admin-1 incl. local names), else the country centre (country precision) | 20 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `eccc` | [MSC GeoMet OGC API `weather-alerts`](https://api.weather.gc.ca/) | Warnings only (`alert_type=warning`), not ended; one event per warning area with its simplified polygon and an interior point; timestamp = publication time (validity start can be in the future); `resolvedAt` = event end / expiry | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `au-emergency` | [NSW RFS major incidents](https://www.rfs.nsw.gov.au/feeds/majorIncidents.json), [VicEmergency events](https://emergency.vic.gov.au/public/events-geojson.json) | NSW: fires at Advice / Watch and Act / Emergency Warning or ≥ 50 ha (planned burns skipped); pubDate is day/month UTC. Victoria: official warnings (Advice and above) and bushfires ≥ 10 ha not marked Safe | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `emsc` | [EMSC FDSN event service](https://www.seismicportal.eu/fdsn-wsevent.html) | M3+ earthquakes, past 3 days (`evtype=ke` only); merges with the USGS record of the same quake via the earthquake dedup rule (100 km, 3 min, magnitudes agree) | 5 min | — | Scientific / `OFFICIAL_PRELIMINARY` |
| `nhc` | [NHC CurrentStorms.json](https://www.nhc.noaa.gov/) | One record per active storm, updated each advisory; storm centre (approximate precision); Saffir-Simpson category derived from max wind. Title includes "tropical cyclone" so GDACS reports of the same storm merge | 15 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `uk-floods` | [Environment Agency flood-monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference) | Severity 1–3 (severe warning, warning, alert) placed at the flood area's reference point (looked up once per area, cached); a severity change supersedes the area's previous record. Times are UK local and converted to UTC | 15 min | — | Official agency / `OFFICIAL_FINAL` |
| `usgs-volcano` | [USGS HANS API](https://volcanoes.usgs.gov/hans-public/api/volcano/) | Volcanoes above NORMAL (advisory / watch / warning) with aviation colour code; location from the volcano record (cached) | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `copernicus-ems` | [Copernicus EMS Rapid Mapping](https://rapidmapping.emergency.copernicus.eu/) public dashboard API | Activations from the last 45 days (or still open), placed at the centroid of the mapped areas (region precision); category mapped to flood / fire / storm / quake / volcano / industrial / disaster | 60 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `spc-reports` | [SPC filtered storm reports](https://www.spc.noaa.gov/climo/reports/) CSV | Tornado / wind / hail sections for the current report day and the two before (a report day runs 12:00–11:59 UTC; times are UTC). "2 SW Town" becomes "2 mi SW of Town"; zone codes in the county column are dropped. Preliminary — may be revised | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `nifc` | [NIFC WFIGS current incident locations](https://data-nifc.opendata.arcgis.com/) (ArcGIS) | Wildfires (`IncidentTypeCategory='WF'`, no prescribed burns) of 100+ acres not declared out; point of origin; dropped when not updated for 30 days, or 3 days once 100% contained | 30 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `news-rss` | Public RSS/Atom feeds of 10 outlets' world desks (list in `src/data-sources/news-rss/client.ts`) | Items from the last 48 h. Placed on a cued place in the headline ("in Gaza"), else the most specific place it names (city → US state → country); the summary is used only when the headline names nowhere, and only a cued place. Unlocatable items are skipped. Category from the headline: hazard words → "disaster news" (never a hazard event, so it can't duplicate official data; figurative uses about markets excluded); PROTEST needs an unambiguous word. Stores headline, ≤300-char summary and link only. `mergeWithinSource` so outlets reporting one story merge | 15 min | — | News media / `MEDIA_REPORT` |
| `federal-register` | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | Presidential documents from the last 14 days. A document whose title names a foreign country is placed in that country (summary says so); others at the White House | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `travel-advisories` | [State Department travel advisory RSS](https://travel.state.gov/_res/rss/TAsTWs.xml) | Level 2–4 advisories whose update date is within 30 days, at the country's label point; a level change supersedes the old level's record | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `cdc-travel` | [CDC Travelers' Health notices RSS](https://wwwnc.cdc.gov/travel/notices) | "Level N - Disease in Country" notices from the last 120 days; global notices (no single country) are skipped. HEALTH dedup merges them with WHO / news reports of the same outbreak | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `adsb-emergency` | [adsb.lol](https://adsb.lol/) `/v2/sqk/{7700,7600,7500}` | Aircraft with a position seen in the last 2 minutes; one record per aircraft, code and UTC hour. Labelled as the broadcast code, not a confirmed incident | 2 min | — | Community database / `MEASUREMENT` |
| `wikipedia-events` | [Portal:Current events](https://en.wikipedia.org/wiki/Portal:Current_events) day pages (`action=raw`), last 3 days | Items that cite a source; section → category. Placed on a cued place, else the first place mentioned (link targets are used, so `[[Vienna, Georgia|Vienna]]` isn't Vienna, Austria), else the parent topic line; events "in the Caribbean Sea" etc. are placed at sea (approximate). Date only (12:00 UTC). CC BY-SA; links to the cited article | 30 min | — | Community database / `MEDIA_REPORT` |
| `air-quality` | [Open-Meteo air-quality API](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS global model) | Current US AQI for the ~200 gazetteer cities of 2M+ (batched 50 per request); only AQI ≥ 151 becomes an event, one per city per day. Modelled, labelled as such | 60 min | — | Scientific / `OFFICIAL_PRELIMINARY` |
| `fdic-failures` | [FDIC BankFind failures API](https://api.fdic.gov/banks/docs/) | Failures in the last 2 years, placed at the bank's city (gazetteer); assets, deposits, acquirer, DIF cost. Date only | 12 h | — | Official agency / `OFFICIAL_FINAL` |
| `fireballs` | [JPL CNEOS fireball API](https://ssd-api.jpl.nasa.gov/doc/fireball.html) | Events with a reported location in the last 12 months; signed lat/lon from N/S/E/W; approximate precision. Published days to weeks after the event | 6 h | — | Official agency / `MEASUREMENT` |
| `space` | [Launch Library 2](https://thespacedevs.com/llapi) upcoming + previous | Launches within ±7 days at the launch pad | 30 min | — (15 req/h free tier) | Community database / `SCHEDULED` |
| `tsunami` | [NOAA tsunami.gov](https://www.tsunami.gov/) Atom feeds (NTWC + PTWC) | Messages from the last 3 days at the event location | 3 min | — | Official agency / `OFFICIAL_FINAL` |
| `faa` | [FAA NAS Status](https://nasstatus.faa.gov/) XML | Ground delay programs, ground stops, arrival/departure delays and full closures at airport coordinates (OurAirports gazetteer) | 5 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `ioda` | [IODA](https://ioda.inetintel.cc.gatech.edu/) outage events | Country-level internet disruptions (strongest signal per outage; >20 min) at the country centre | 15 min | — | Scientific / `MEASUREMENT` |
| `who` | [WHO Disease Outbreak News](https://www.who.int/emergencies/disease-outbreak-news) | Reports from the last 45 days at the affected country; successive reports on one outbreak merge into one event | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `sec` | [SEC EDGAR](https://www.sec.gov/edgar) latest 8-K filings + company profiles | Filings with material items (bankruptcy, cyber incident, restatement, M&A, earnings, delisting, leadership) at the company's registered business address | 10 min | — (descriptive User-Agent) | Official / `OFFICIAL_FINAL` (the filing itself) |
| `demo` | Built-in generator | Simulated events — **demo mode only** | 5 min | — | Synthetic / `SYNTHETIC` |

## Planet panel (`src/lib/planet`)

Top bar → **Planet**: daily CO₂ at Mauna Loa (NOAA GML), monthly global land+ocean temperature anomaly (NOAA NCEI), daily Arctic sea-ice extent (NSIDC), Oceanic Niño Index (NOAA CPC), planetary Kp index, current R/S/G space-weather scales and M/X-class flares in the last 7 days (NOAA SWPC), plus a table of asteroid close approaches within 0.05 au in the next 30 days (JPL SBDB close-approach API; size range estimated from absolute magnitude for albedo 0.25–0.05). Each tile states what its change compares against (a year earlier, previous month, previous season, 3 hours earlier). Cached 3 h.

## Map views

- **Satellite** (map button **SAT**, or Settings → Map style): NASA Blue Marble for the whole globe, then EOX **Sentinel-2 cloudless 2024** (10 m) from zoom 4 — keyless WMTS tiles, CC BY-NC-SA 4.0 (non-commercial use with attribution).
- **States and provinces**: `npm run geo:regions` builds `public/geo/regions.geojson` from Natural Earth 10m admin-1 (4,596 regions, simplified to ~2 km; ~1.4 MB gzipped). It loads the first time the map is zoomed past level 3; from there, hover and click switch from countries to states/provinces (markets mode stays per-country). The region panel counts the events currently on the map whose location falls inside the boundary.

## Public cameras (`src/layers/cameras`)

Map button **CAM** shows ~7,000 traffic and road-weather cameras that operators publish as open data (TfL London, NYC DOT, Caltrans, Hong Kong Transport Department, Fintraffic, Singapore LTA). Click one to see its latest image (refreshed on the operator's cadence) or, where offered, a video clip (TfL MP4) or live stream (Caltrans HLS, via hls.js). Media loads directly from the operator. Only operator-published public cameras are included — never private or unsecured devices. The camera list is cached 6 h.

## Trends panel (`src/lib/trends`)

Top bar → **Trends** (`GET /api/trends`): what people are searching for, reading and sharing, as an attention signal next to world events. Trends are **not events**: they never enter the event store, and the panel says they are attention signals, not verified events. All sources are keyless; the whole set is cached 15 minutes, and when a source fails the last good copy is served (listed as "last successful fetch"). A source with no data at all is listed as unavailable — nothing is filled in.

| Source | Endpoint | Coverage | Notes |
| --- | --- | --- | --- |
| Google Trends trending searches | `trends.google.com/trending/rss?geo=XX` | 41 countries, 10 terms each | Approximate traffic bucket (e.g. "2000+") and up to 3 linked news headlines per term. Fetched 6 countries at a time. "Trending in several countries" groups terms by case/accent/punctuation-folded title, so it only matches identical spellings (e.g. team names, events), not translations. `?geo=XX` returns one country (used by the country overview) |
| Wikipedia most-read articles | Wikimedia REST `metrics/pageviews/top/{lang}.wikipedia/all-access/{yyyy}/{mm}/{dd}` | 12 editions: en, es, de, fr, ja, ru, it, zh, pt, pl, ar, nl | Yesterday (UTC), or the day before if not yet published. Main pages and non-article namespaces are removed using each wiki's siteinfo (cached 24 h) with built-in localised names as a fallback. Counts can include automated traffic Wikimedia didn't filter. Wikimedia rate-limits bursts, so editions are fetched two at a time and a 429 is retried once after `Retry-After` |
| Bluesky trending topics | `public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends` (falls back to `getTrendingTopics`) | Network-wide | Topic, description, post count, status, category. The `actors` (post authors) field is discarded. The endpoint is "unspecced" and may change |
| Mastodon trends | `mastodon.social/api/v1/trends/tags`, `/trends/links` | One large server, not the whole fediverse | Usage summed over the last two daily buckets. Link author fields are discarded |
| Hacker News front page | `hn.algolia.com/api/v1/search?tags=front_page` | Technology | Title, link, points, comments; submitter names are discarded |

**Not included**

- **X/Twitter**: X has no free or keyless API for trends, and third-party trend scrapers (trends24, getdaytrends, …) are deliberately not used.
- **Reddit**: `www.reddit.com/r/worldnews/hot.json` returns 403 to unauthenticated clients, the API requires OAuth, and `reddit.com/robots.txt` disallows all automated access (`User-agent: * / Disallow: /`).

Privacy: only aggregate trends and public post/article titles are kept. No user handles, avatars, author names or other data about individuals are stored or shown.

## Live layers (`src/layers/`)

Live layers are continuously changing observations visualised in map modes. They are **not events**: they never enter the event store, scoring or deduplication. Each is fetched on demand through `/api/layers/:id` and cached server-side for its TTL, so upstream quotas are only used while someone is looking, and every client shares one cached copy. If an upstream fetch fails, the last good snapshot is served with `stale: true` (shown in the legend).

| ID | Source | Mode | Cache | Key | Notes |
| --- | --- | --- | --- | --- | --- |
| `weather-radar` | [RainViewer](https://www.rainviewer.com/api.html) weather-maps index + tiles | Weather | 5 min | — | 13 past frames (2 h) + nowcast; coverage only where national radar networks share data; attribution required |
| `aviation` | [OpenSky Network](https://opensky-network.org/) `/states/all` | Aviation | 20 min | optional `OPENSKY_CLIENT_ID/SECRET` | Anonymous quota is 400 credits/day; a global snapshot costs 4, so the 20-min cache keeps continuous use under ~290/day. Positions older than 2 min are dropped. Non-commercial use terms apply |
| `maritime` | [AISStream.io](https://aisstream.io/) websocket | Maritime | 1 min | `AISSTREAM_API_KEY` (free) | A websocket stays open while the mode is used (closed after 10 idle minutes); latest position per vessel, last 30 min; terrestrial AIS is sparse in open ocean |

Adding a layer: create `src/layers/<id>/` with a `LiveLayerProvider` (`load()` returns a snapshot), register it in `src/layers/registry.ts`, add a mode in `src/lib/map-modes.ts` and its map layers in `src/components/globe/layers.ts`.

## Reference geography (bundled, `npm run geo:build`)

Natural Earth countries (1:50m), populated places, and admin-1 states/provinces (label points + local/alternate names); OurAirports large/medium airports. All public domain.

## Considered but not used

- **ReliefWeb API** now requires a pre-approved app name (returns 403 without one).
- **Smithsonian GVP weekly volcano RSS** blocks programmatic access (403).
- **Stooq** no longer serves quote CSVs.
- **World Bank and IMF DataMapper APIs** time out or deny access from this environment, so country economic profiles aren't included yet.
- **Polymarket** (prediction markets) API timed out.
- **SEC EDGAR "current filings" Form 4 feed** (market-wide insider trades) refuses automated clients.
- **Nasdaq earnings calendar** API blocks non-browser clients.
- **GeoNet (NZ) volcanic alert levels** carry no timestamp, so they can't be placed in time without inventing one.
- **Canadian CWFIS active fires** WFS layer is no longer published under its documented name; NASA FIRMS covers Canadian fires.

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
