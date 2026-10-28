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
| `jma-quake` | [JMA earthquake list](https://www.jma.go.jp/bosai/quake/data/list.json) (bosai JSON) | One event per JMA event id from the past 7 days: hypocentre (ISO 6709 `cod`) and magnitude from the newest bulletin that has one, maximum JMA seismic intensity (shindo) across all bulletins; intensity-flash-only events skipped until located. Origin time is JST (+09:00, to the minute) → UTC | 5 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `jma-volcano` | [JMA volcanic warnings](https://www.jma.go.jp/bosai/volcano/data/warning.json) + [volcano list](https://www.jma.go.jp/bosai/volcano/const/volcano_list.json) | Volcanoes at alert level 2+ or under a near-crater / marine volcanic warning (level 1 and lifted warnings skipped), at the summit; timestamp = issue time of the warning in force (can be years old for long-running warnings) | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `bmkg` | [BMKG](https://data.bmkg.go.id/gempabumi/) `gempaterkini.json` (latest 15 M5+) and `gempadirasakan.json` (latest 15 felt) | Each quake, the two lists merged by origin time; felt intensities (MMI) and tsunami-potential statement in the summary. `DateTime` is UTC; otherwise the local date/time is converted (WIB +7, WITA +8, WIT +9) | 5 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `geonet` | [GeoNet quake API](https://api.geonet.org.nz/) `quake?MMI=3` | Felt quakes (modelled MMI 3+) of the past 7 days; deleted solutions skipped. Volcanic alert levels are not ingested (no issue time in the feed) | 5 min | — | Official agency / `OFFICIAL_FINAL` if quality `best`, else `OFFICIAL_PRELIMINARY` |
| `afad` | [AFAD event API](https://deprem.afad.gov.tr/) `apiv2/event/filter` | M3+ of the past 3 days in and around Türkiye. Dates have no zone suffix and are UTC (verified against EMSC) | 5 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `ssn-mexico` | [SSN (UNAM) latest earthquakes RSS](http://www.ssn.unam.mx/rss/ultimos-sismos.xml) (HTTP only) | Each of the latest ~15 located quakes; "Hora de México" is UTC−6 all year (no DST since 2022) → UTC | 5 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `hko-warnings` | [Hong Kong Observatory open data](https://data.weather.gov.hk/weatherAPI/opendata/weather.php) `warnsum` + `warningInfo` | Each warning in force (tropical cyclone signal, rainstorm, northern NT flooding, landslip, tsunami, thunderstorm, heat/cold/frost, fire danger, monsoon); cancelled or expired skipped. Territory-wide, so placed at Hong Kong (city precision); HKT (+08:00) → UTC | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `nhc` | [NHC CurrentStorms.json](https://www.nhc.noaa.gov/) | One record per active storm, updated each advisory; storm centre (approximate precision); Saffir-Simpson category derived from max wind. Title includes "tropical cyclone" so GDACS reports of the same storm merge | 15 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `uk-floods` | [Environment Agency flood-monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference) | Severity 1–3 (severe warning, warning, alert) placed at the flood area's reference point (looked up once per area, cached); a severity change supersedes the area's previous record. Times are UK local and converted to UTC | 15 min | — | Official agency / `OFFICIAL_FINAL` |
| `usgs-volcano` | [USGS HANS API](https://volcanoes.usgs.gov/hans-public/api/volcano/) | Volcanoes above NORMAL (advisory / watch / warning) with aviation colour code; location from the volcano record (cached) | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `copernicus-ems` | [Copernicus EMS Rapid Mapping](https://rapidmapping.emergency.copernicus.eu/) public dashboard API | Activations from the last 45 days (or still open), placed at the centroid of the mapped areas (region precision); category mapped to flood / fire / storm / quake / volcano / industrial / disaster | 60 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `spc-reports` | [SPC filtered storm reports](https://www.spc.noaa.gov/climo/reports/) CSV | Tornado / wind / hail sections for the current report day and the two before (a report day runs 12:00–11:59 UTC; times are UTC). "2 SW Town" becomes "2 mi SW of Town"; zone codes in the county column are dropped. Preliminary — may be revised | 10 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `nifc` | [NIFC WFIGS current incident locations](https://data-nifc.opendata.arcgis.com/) (ArcGIS) | Wildfires (`IncidentTypeCategory='WF'`, no prescribed burns) of 100+ acres not declared out; point of origin; dropped when not updated for 30 days, or 3 days once 100% contained | 30 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `news-rss` | Public RSS/Atom feeds of 42 outlets (list in `src/data-sources/news-rss/outlets.ts`). **Global:** BBC, Al Jazeera, NPR, Deutsche Welle, France 24, UN News, The Guardian, CNBC, Sky News, ABC Australia. **Asia:** South China Morning Post, The Japan Times, The Hindu (national), Times of India (world), Dawn, The Straits Times (Asia), CNA (Asia), Yonhap, VnExpress International, The Irrawaddy. **Middle East:** Arab News, Al-Monitor, Haaretz, The National, Middle East Eye. **Africa:** Africanews, AllAfrica (headline feed; display with attribution and link is permitted by its RSS terms), Premium Times, Daily Maverick, The Africa Report. **Latin America:** MercoPress, Buenos Aires Times, Mexico News Daily, The Rio Times, Colombia Reports. **Europe:** The Kyiv Independent, Meduza, Balkan Insight, Euronews, RFE/RL. **Americas/Oceania:** CBC News, RNZ Pacific. Not used (Oct 2026 probe): Reuters/AP (no public RSS), NHK World, Kyodo, Mail & Guardian, Nation (Kenya) (feeds 404), Times of Israel, The East African, News24 main site, Guardian Nigeria (403 to non-browser clients), Nikkei Asia and Kathmandu Post (no item dates), VOA, Jerusalem Post, Global Times (feeds stale), Korea Times (1 item), Politico Europe (few, partly French items), Tehran Times (state-aligned) | Fetched 8 feeds at a time, ≤ 12 s per feed, ≤ 60 newest items per feed; a failed feed only loses itself. Reads RSS 2.0, RDF and Atom (rel=alternate links, CDATA-wrapped dates, `dc:date`). Items from the last 48 h. Placed on a cued place in the headline ("in Gaza"), else the most specific place it names (city → home-country town/province → US state → country), else the one nationality it names ("Bulgarian PM…"; skipped if two nationalities or a modifier like "Saudi-backed"); the summary is used only when the headline names nowhere, and only a cued place. A national outlet (`home`) has its own country's smaller towns and states/provinces recognised when capitalised in a headline ("Punjab" → Pakistan for Dawn, India for The Hindu); a stop-list keeps out everyday words (Delta, Rivers, Saga …). Unlocatable items are skipped. Category from the headline: hazard words → "disaster news" (never a hazard event, so it can't duplicate official data; figurative uses about markets excluded); PROTEST needs an unambiguous word. Stores headline, ≤300-char summary and link only. `mergeWithinSource` so outlets reporting one story merge | 15 min | — | News media / `MEDIA_REPORT` |
| `federal-register` | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | Presidential documents from the last 14 days. A document whose title names a foreign country is placed in that country (summary says so); others at the White House | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `travel-advisories` | [State Department travel advisory RSS](https://travel.state.gov/_res/rss/TAsTWs.xml) | Level 2–4 advisories whose update date is within 30 days, at the country's label point; a level change supersedes the old level's record | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `fcdo-travel` | [GOV.UK Content API](https://www.gov.uk/api/content/foreign-travel-advice) (UK FCDO foreign travel advice, OGL v3) | The index gives each destination's last update; only destinations updated within 30 days are fetched (4 at a time, ≤ 80; unchanged pages reused from memory). Kept when `details.alert_status` says the FCDO advises against all or all-but-essential travel to the whole country or parts of it; the most severe status is the record's level, the summary lists every status, the description is GOV.UK's change note. A status change supersedes the old record. Destinations with no such advice are skipped | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `canada-travel` | [Government of Canada travel advisories JSON](https://data.international.gc.ca/travel-voyage/index-updated.json) | `advisory-state` 2 ("Avoid non-essential travel") or 3 ("Avoid all travel"), page updated within 30 days; ISO code → country; the advice is Canada's own wording ("…(with regional advisories)" kept); the description is the feed's recent-update note (most updates are editorial — the level itself may not have changed). A state change supersedes the old record | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `smartraveller` | [Smartraveller destinations export](https://www.smartraveller.gov.au/destinations-export) (Australian Government, CC BY 4.0) | Overall level 3 ("Reconsider your need to travel") or 4 ("Do not travel"), `changed` within 30 days (`changed` is Sydney local time; AEST/AEDT applied). Destinations whose overall level is lower but with level-4 areas are not mapped. Note: the site answers Node's fetch but curl requests stall | 6 h | — | Official agency / `OFFICIAL_FINAL` |
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
| `central-banks` | RSS: [Federal Reserve](https://www.federalreserve.gov/feeds/press_all.xml), [ECB](https://www.ecb.europa.eu/rss/press.html), [Bank of England](https://www.bankofengland.co.uk/rss/news), [Bank of Japan](https://www.boj.or.jp/en/rss/whatsnew.xml), [Bank of Canada](https://www.bankofcanada.ca/content_type/press-releases/feed/) | Releases from the last 14 days at the bank's HQ (city precision), `MARKETS`. Rate decisions are recognised only from the bank's own title ("FOMC statement", "Monetary policy decisions", "Bank Rate maintained at …", "Statement on Monetary Policy", "maintains the policy rate") and prefixed "Rate decision —"; the rate is never inferred. Skipped: Fed bank-application approvals, BoE committee minutes other than the MPC, BoJ statistical releases. Fed content is public domain; the others are official feeds — link back | 15 min | — | Official agency / `OFFICIAL_FINAL` |
| `ofac-sanctions` | [OFAC Sanctions List Service](https://sanctionslistservice.ofac.treas.gov/) `changes/history/{year}` + `changes/{id}` delta files | One event per list publication of the last 14 days (newest 6): additions / removals / updates, top programs, address countries, first names added. History times have no zone; the delta file's offset (US Eastern) is applied. Placed at the Treasury. Public domain | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `sanctions-news` | [Council of the EU press releases RSS](https://www.consilium.europa.eu/en/rss/pressreleases.ashx), [GOV.UK news search "sanctions"](https://www.gov.uk/search/news-and-communications.atom?keywords=sanctions&order=updated-newest) (OGL v3) | Titles about sanctions / restrictive measures / designations from the last 21 days; placed in the country the title names (other than the issuer's), else Brussels / Whitehall | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `cloud-status` | [AWS Health Dashboard RSS](https://status.aws.amazon.com/rss/all.rss), [Google Cloud incidents.json](https://status.cloud.google.com/incidents.json), [Azure status RSS](https://azurestatuscdn.azureedge.net/en-us/status/feed/), Statuspage APIs of [Cloudflare](https://www.cloudflarestatus.com/api/v2/incidents.json) and [DigitalOcean](https://status.digitalocean.com/api/v2/incidents.json) | Incidents opened in the last 2 days, or still open (≤ 14 days). AWS updates are grouped per service/region (gaps > 24 h start a new incident); "[RESOLVED]"/"operating normally" resolves. GCP/AWS placed at the named cloud region, Cloudflare PoP incidents ("in Ashburn, IAD") at the airport, others at the operator's HQ. Resolved incidents carry `resolvedAt` (event → RESOLVED). Statuspage impact `none` skipped. **Azure's feed lists only active incidents with no id or end time, so Azure events are never auto-resolved.** First-party company status pages (filed as `OFFICIAL_AGENCY` for lack of a company source type; credibility basis says so) | 5 min | — | Official agency* / `OFFICIAL_PRELIMINARY` |
| `app-status` | Statuspage v2 `incidents.json` of GitHub, Discord, OpenAI, Claude, Zoom, Shopify, Atlassian, Reddit; [Slack status API](https://slack-status.com/api/v2.0.0/history) | Same rules as `cloud-status` (`TECHNOLOGY`); Slack incidents/outages only (no notices). Placed at the company's HQ | 10 min | — | Official agency* / `OFFICIAL_PRELIMINARY` |
| `fda-recalls` | [openFDA enforcement](https://open.fda.gov/apis/food/enforcement/) food / drug / device | **Class I** recalls with a report date in the last 14 days, one event per recall `event_id` (products counted), at the recalling firm's city (gazetteer), else FDA HQ. Keyless limit 1,000 requests/day/IP (3 per run). Public domain | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `cpsc-recalls` | [CPSC Recalls API](https://www.saferproducts.gov/RestWebServices/Recall) (SaferProducts.gov) | Recalls dated in the last 21 days (`OTHER` / product recall) with units, hazards, injuries; nationwide, so placed at CPSC HQ. The API sometimes answers 200 with an "Error retrieving Recalls" placeholder — treated as a failed run. Public domain | 6 h | — | Official agency / `OFFICIAL_FINAL` |
| `ransomware-live` (**off**: the API returns 404 to WorldView's identified client; not re-registered until it accepts it) | [ransomware.live API v2](https://api.ransomware.live/v2/recentvictims) `recentvictims` | Leak-site claims from the last 3 days with a victim country (others skipped), at the country (`TECHNOLOGY` / cyber attack). Labelled as the group's **unverified claim**; the group's post text, screenshots and .onion links are dropped. Free for non-commercial use; attribution requested | 30 min | — | Community database / `MEDIA_REPORT` |
| `hibp-breaches` | [Have I Been Pwned](https://haveibeenpwned.com/api/v3/breaches) `GET /api/v3/breaches` (keyless; ~1 MB) | Breaches **added** in the last 14 days (spam lists, fabricated and retired skipped). No location upstream: a country-code domain (afd.de) places it in that country, otherwise at HIBP (Australia, approximate) and the summary says so. CC BY 4.0 — attribution link required | 6 h | — | Community database / `OFFICIAL_PRELIMINARY` if verified, else `MEDIA_REPORT` |
| `un-press` | [UN Meetings Coverage and Press Releases RSS](https://press.un.org/en/rss.xml) | Security Council, General Assembly and Secretary-General releases from the last 7 days (daily briefings and notes skipped); placed in a non-US country the headline names, else UN HQ New York | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `nasdaq-halts` | [Nasdaq Trader trading halts RSS](https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts) (`ndaq:` fields) | Halts with their reason code (news pending/released, regulatory concern, SEC suspension, additional information requested, market-wide circuit breaker …), `MARKETS`. **LULD volatility pauses (`LUDP`/`LUDS`/`M`) are skipped** — dozens a day, a few minutes each. Halts resumed more than 3 days ago dropped; halts still in force kept up to 14 days. Halt/resumption times are US Eastern wall-clock → UTC; resumption sets `resolvedAt`. One record per symbol + halt time. Placed at the listing exchange (Nasdaq MarketSite, or NYSE for NYSE / NYSE American listings), city precision. Nasdaq is an exchange, filed as `OFFICIAL_AGENCY` for lack of an exchange source type (credibility basis says so) | 5 min | — | Official* / `OFFICIAL_FINAL` |
| `sec-insider-buys` | [EDGAR latest filings Atom](https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&output=atom) (2 pages) + each new filing's full submission `.txt` | Form 4 filings (not 4/A) whose non-derivative table has **open-market purchases** (code `P`, acquired) totalling **≥ $100,000** — one event per filing (`MARKETS` / insider purchase) with shares, average price, value and trade dates, at the issuer's business address from the SEC header (gazetteer; state centre when the city is unknown; else SEC HQ). Timestamp = filing acceptance time. ≤ 60 new filings read per run, 150 ms apart (SEC ≤ 10 req/s); filings already read are cached in-process. Needs `WORLDVIEW_CONTACT` in the User-Agent (SEC fair-access policy). Public domain | 10 min | — (descriptive User-Agent) | Official agency / `OFFICIAL_FINAL` (the filing itself) |
| `sec-enforcement` | SEC RSS: [trading suspensions](https://www.sec.gov/enforcement-litigation/trading-suspensions/rss), [litigation releases](https://www.sec.gov/enforcement-litigation/litigation-releases/rss), [administrative proceedings](https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss), [press releases](https://www.sec.gov/news/pressreleases.rss) | Items from the last 14 days (`MARKETS`). Upstream titles of suspensions / litigation / proceedings are only the respondent's name, so the title is "SEC trading suspension 34-106668: TJGC Group Limited" (release number from the link); press releases keep their own title and are labelled "enforcement action" when it says charges / settles / fraud. Placed at SEC HQ (respondents' locations aren't published). Public domain | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `treasury-auctions` | [TreasuryDirect securities web service](https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&days=7) `TA_WS/securities/auctioned` | Each auction of the last 7 days **with results** (one per CUSIP + auction date): high rate (bills) / high yield (notes, bonds, TIPS) / high discount margin (FRNs), bid-to-cover, amount awarded, indirect bidders' share of competitive awards — as published, never estimated. Timestamp = TreasuryDirect's `updatedTimestamp` (US Eastern → UTC), i.e. when results were posted; links the results PDF. At the Treasury, Washington. Fiscal Data's `auctions_query` was not used: it fills results in only days later. Public domain | 15 min | — | Official agency / `OFFICIAL_FINAL` |
| `ecdc` | ECDC RSS: [risk assessments](https://www.ecdc.europa.eu/en/taxonomy/term/1295/feed), [epidemiological updates](https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed), [news](https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed) | Items from the last 14 days (`HEALTH`), labelled by feed (an item in two feeds keeps the first: risk assessment > epi update > news); corporate items (Management Board, vacancies, tenders) skipped. Placed in the country the title names (other than Sweden), else at ECDC, Solna. The weekly Communicable Disease Threats Report digest is not ingested (one PDF digest a week, no single event). Reuse authorised with acknowledgement | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `iaea` | [IAEA Top News RSS](https://www.iaea.org/feeds/topnews) | Press releases and news (`/newscenter/news/` and `/newscenter/pressreleases/`) from the last 14 days; photo essays, multimedia and explainers ("What is …?") skipped. Nuclear-safety wording (Situation in Ukraine, ZNPP, reactor, ALPS, IRRS/OSART missions, incident …) → `INFRASTRUCTURE` / nuclear safety, else `SCIENCE`. The feed's dates are `YY-MM-DD HH:MM` Vienna local time without a zone → converted from Europe/Vienna. Placed in the country the headline names (other than Austria), else at the Vienna International Centre | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `volcanic-ash` | [NOAA AWC international SIGMET API](https://aviationweather.gov/api/data/isigmet?format=json&hazard=va) (`hazard=va`) | Volcanic ash SIGMETs from every meteorological watch office, grouped into **one event per volcano per UTC day** (successive SIGMETs and neighbouring FIRs update it). Volcano name and position parsed from the SIGMET text (`VA ERUPTION MT … PSN N3136 E13039`) → exact precision at the volcano; latest observed ash-cloud polygon as geometry; highest ash top (FL), issuing office, valid-until. Forecast-only duplicates (series ending `F`) and SIGMETs without a `PSN` skipped. `VOLCANO` (merges with USGS / JMA / GDACS volcano events within 40 km). Public domain | 15 min | — | Official agency / `OFFICIAL_PRELIMINARY` |
| `eu-commission` | [European Commission Press Corner RSS](https://ec.europa.eu/commission/presscorner/api/rss?language=en&pagesize=60) | Press releases (`ip`), statements, readouts and joint press releases from the last 7 days (speeches, Daily News, Q&As, factsheets, agendas skipped); competition / trade / economic items `MARKETS`, the rest `POLITICS`; placed in a non-Belgian country the headline names, else the Berlaymont, Brussels | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `defense-releases` | war.gov (defense.gov redirects there) RSS: [news releases](https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=40), [contracts](https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=10) | Releases (readouts, statements, announcements) and the daily contract-announcement digest ($7.5M+; the feed carries only the day's digest link, not each award) from the last 7 days, at the Pentagon | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `doj-press` | [DOJ Office of Public Affairs press releases RSS](https://www.justice.gov/news/rss?type=press_release&m=1) | Only major cases, last 7 days: corporate/financial (antitrust, securities, sanctions/export evasion, bribery, laundering, crypto, settlements, or $10M+ in the headline → `BUSINESS`) and national security (espionage, terrorism, foreign agents, cyber → `POLITICS`); routine individual cases skipped. Placed in a non-US country or US state (state centre) the headline names, else DOJ HQ. Summaries note that charges are allegations | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `trade-policy` | [WTO latest news RSS](https://www.wto.org/library/rss/latest_news_e.xml), [USTR press releases RSS](https://ustr.gov/rss.xml) | Items from the last 10 days; trade remedies, disputes, tariff actions and agreements `MARKETS`, the rest `POLITICS`. WTO items naming a member are placed there (country/city), else WTO Geneva; USTR at its Washington office | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `fda-medwatch` | [FDA MedWatch safety alerts RSS](https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml) | Alerts from the last 21 days: device early alerts, device/product recalls, safety communications; at FDA HQ (complements `fda-recalls`, which only has classified openFDA reports) | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `ifrc-appeals` | [IFRC GO appeals API](https://goadmin.ifrc.org/api/v2/appeal/?limit=60&ordering=-start_date) | DREF allocations and Emergency Appeals started in the last 30 days, at the country (label point, `country` precision; country from the record, else the `MDR<ISO2>` appeal code, else the name). Category from the IFRC disaster type; CHF requested/funded and people targeted in metrics | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `nasa-news` | [NASA news feed](https://www.nasa.gov/news-release/feed/) (site-wide, ~10 newest) | Releases from the last 7 days (image-of-the-day, blog, Earth Observatory posts and media advisories skipped); `SPACE` for spaceflight/astronomy, else `SCIENCE`; at the NASA field centre the headline names with a cue ("at Kennedy", "Johnson Space Center"), else NASA HQ | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `us-economic-releases` | [BEA RSS](https://apps.bea.gov/rss/rss.xml), [Census Economic Briefing Room RSS](https://www.census.gov/economic-indicators/indicator.xml) | Releases from the last 7 days (GDP, personal income/PCE, trade, retail sales, durable goods, housing starts, new home sales, inventories, …); Census titles get the reference period from the release text and are keyed by title + date (Census reuses one link per indicator); the release's first sentence is quoted; at the Suitland Federal Center, MD | 15 min | — | Official agency / `OFFICIAL_FINAL` |
| `eia-energy` | [EIA Today in Energy RSS](https://www.eia.gov/rss/todayinenergy.xml), [EIA press releases RSS](https://www.eia.gov/rss/press_rss.xml) (keyless RSS, not the keyed API) | Articles and press releases (outlooks labelled) from the last 14 days, `MARKETS`, topic (oil / natural gas / power) in metrics; at EIA, Washington | 60 min | — | Official agency / `OFFICIAL_FINAL` |
| `market-regulators` | (SEC press releases come from `sec-enforcement`) [CFTC press releases RSS](https://www.cftc.gov/RSS/RSSGP/rssgp.xml) | Releases from the last 10 days, `MARKETS`, subtype enforcement action / rulemaking / meeting / international cooperation; largest $ amount in the headline in metrics; at each regulator's HQ. (SEC litigation releases not added: sec.gov answered 403 "Request Rate Threshold Exceeded" during verification.) | 30 min | — | Official agency / `OFFICIAL_FINAL` |
| `demo` | Built-in generator | Simulated events — **demo mode only** | 5 min | — | Synthetic / `SYNTHETIC` |

Agency press-release connectors (`defense-releases`, `eia-energy`, `trade-policy`, `fda-medwatch`, `nasa-news`, `market-regulators`, `doj-press`, `eu-commission`, `us-economic-releases`) share `src/data-sources/agency-feeds/common.ts`: each lists its feeds and a `classify` function; titles are the publisher's own (an issuer prefix such as "DOJ: " is added only when the title doesn't name the issuer), ids are `<feed>:<hash of link>`, and records sit at the issuer's headquarters (`city`) unless the headline names a better place.

Checked and not added (keyless + honest client required): OPEC press RSS and IEA news (403 to WorldView's identified client), NATO news RSS (old feed URLs 404, no current feed found), CDC Health Alert Network RSS (feed empty since 2025), FDA drug safety communications RSS (404), IFES ElectionGuide (no public feed/API), Wikidata SPARQL upcoming elections (query times out at the public endpoint), BLS latest releases and IMF news RSS (403), SEC litigation releases (403 rate threshold).

## Planet panel (`src/lib/planet`)

Top bar → **Planet**: daily CO₂ at Mauna Loa (NOAA GML), monthly global land+ocean temperature anomaly (NOAA NCEI), daily Arctic sea-ice extent (NSIDC), Oceanic Niño Index (NOAA CPC), planetary Kp index, current R/S/G space-weather scales and M/X-class flares in the last 7 days (NOAA SWPC), plus a table of asteroid close approaches within 0.05 au in the next 30 days (JPL SBDB close-approach API; size range estimated from absolute magnitude for albedo 0.25–0.05). Each tile states what its change compares against (a year earlier, previous month, previous season, 3 hours earlier). Cached 3 h.

## Energy panel (`src/lib/energy`)

Top bar → **Energy** (`GET /api/energy`): one card per grid with demand, renewable share, carbon intensity, wholesale price and a generation-mix bar (fixed colour per fuel, always with a text label and %). Every value carries its own UTC timestamp and a note on what it is. Keyless; cached 10 min. Each grid loads independently: a grid that fails keeps its last good copy (marked "showing last good data"), otherwise it is listed as unavailable, and a missing part (e.g. no price feed) shows "Not available" rather than a number.

| Grid | Source | Demand | Mix / renewable share | Carbon intensity | Price |
| --- | --- | --- | --- | --- | --- |
| Great Britain | [NESO Carbon Intensity API](https://carbonintensity.org.uk/) (CC BY 4.0) + [Elexon Insights](https://bmrs.elexon.co.uk/) | Elexon demand outturn, 5 min | Half-hourly % by fuel incl. imports; renewable = wind, solar, hydro, biomass | Actual (else forecast) gCO₂/kWh, half-hourly | Elexon Market Index Price (APX), £/MWh, half-hourly |
| Spain | [Red Eléctrica REData](https://www.ree.es/en/datos/apidata) | Real-time peninsular demand, 5 min | Previous Spanish calendar day, national, MWh by technology; renewable per REE's classification | Previous day, tCO₂/MWh × 1000 | Day-ahead spot (OMIE) for the current 15-min period, €/MWh |
| France | [RTE éCO2mix](https://www.rte-france.com/en/eco2mix) real-time via [ODRE](https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/) (Licence Ouverte) | Consumption, 15 min | Production by fuel; pumped-storage turbining and battery discharge counted as storage, not hydro; exchanges excluded | RTE's CO₂ rate for French production | — (no keyless feed) |
| Germany | [Bundesnetzagentur SMARD](https://www.smard.de/en) chart data (CC BY 4.0) | Grid load, hourly | Net generation by fuel at the same hour (lignite + hard coal = coal; pumped storage = storage) | — (not published) | Day-ahead DE-LU, hourly average, €/MWh |
| Australia (NEM) | [AEMO NEM data dashboard](https://aemo.com.au/en/energy-systems/electricity/national-electricity-market-nem/data-nem/data-dashboard-nem) `ELEC_NEM_SUMMARY` (public, attribution) | Sum of 5 regions, 5-min dispatch | — | — | Per-region dispatch prices plus a demand-weighted mean, A$/MWh |

Caveats: real-time figures are provisional and revised by the operators; SMARD lags real time by a few hours; NEM times are AEST (UTC+10) converted to UTC. Not used: US EIA (API key required), Nord Pool (licensed data), ENTSO-E Transparency (token required).

## Security panel (`src/lib/cyber`)

Top bar → **Security** (`GET /api/cyber`, cached 1 h, one upstream load at a time):

- **Newly exploited (CISA KEV)** — [Known Exploited Vulnerabilities catalog JSON](https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json) (~1.8 MB): newest additions with vendor/product, date added, federal remediation due date and CISA's "known ransomware campaign use" flag; counts for 7 / 30 days and the catalog total.
- **New critical CVEs** — [NVD CVE API 2.0](https://nvd.nist.gov/developers/vulnerabilities), keyless: one request per hour for `cvssV3Severity=CRITICAL` published in the last 7 days. Score is the Primary CVSS v3.x metric (else the first); rejected CVEs skipped; CVEs also in KEV are flagged. Keyless clients are limited to 5 requests / 30 s.
- **Latest travel-advisory changes** — the four advisory connectors (`travel-advisories`, `fcdo-travel`, `canada-travel`, `smartraveller`) run with the same filters as on the map, newest first, linking to each government's page.

Advisories from different governments are never merged by deduplication (each is its own official record).

## Map views

Map button **SAT** (or Settings → Map → Map style) switches to satellite. A small panel then picks the **satellite source** and always says what is on screen: the imagery's name, its resolution, its image time when there is one, and whether it is a **near-real-time** frame or an **archive mosaic**. Every source below is keyless and credited in the map's attribution control (the ⓘ button).

**Two kinds of imagery — never confuse them.** The very sharp imagery is a *mosaic of past captures* (months to years old, different dates side by side) and is **not live**. The imagery that updates every 10 minutes comes from geostationary weather satellites at **~0.5–2 km per pixel**: good for clouds, storms, smoke and day/night, useless for buildings. Nothing keyless offers both.

| Source (picker option) | Tiles | Resolution / zoom | Cadence | Licence |
| --- | --- | --- | --- | --- |
| **Best detail (mosaic)** — NASA Blue Marble | GIBS `BlueMarble_ShadedRelief_Bathymetry` (Level8) | ~500 m, whole globe | static (2004 composite) | NASA, public domain |
| ↳ EOX Sentinel-2 cloudless 2024 | `tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857` | 10 m, fades in at zoom 4→5 | yearly mosaic | CC BY-NC-SA 4.0 (non-commercial, attribution) |
| ↳ Esri World Imagery (default "zoom detail") | `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 0.3–1 m in many places, fades in at zoom 10.5→11.5, map zooms to **19** | mosaic of captures from various dates | Esri terms of use: attribution required ("Esri, Vantor, Earthstar Geographics, and the GIS User Community" — the service's own credit text, checked Oct 2026; Vantor is the former Maxar imagery business). Treat as **non-commercial use with attribution**; switch it off for anything else |
| ↳ USGS The National Map (alternative "zoom detail") | `basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | ~1 m aerial (USDA NAIP), **US only**; cached tiles to level 16, map zooms to 18 | refreshed periodically ("June 2024" at time of writing) | US government, public domain |
| **Live — geostationary (≈10 min)** | GIBS `GOES-East_ABI_GeoColor`, `GOES-West_ABI_GeoColor` (Level7), `Himawari_AHI_Band3_Red_Visible_1km` (Level7, local daytime) / `Himawari_AHI_Band13_Clean_Infrared` (Level6, night) | ~0.5–2 km; fades to the mosaic at zoom 7.5→9 | every 10 min, published ~30–60 min after capture | NOAA / JMA data via NASA GIBS, public domain |
| **Daily — VIIRS (last full day)** | GIBS `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (Level9) | ~375 m; fades to the mosaic at zoom 9.5→11 | one global composite per day | NASA/NOAA, public domain |
| **Night — VIIRS night band** | GIBS `VIIRS_SNPP_DayNightBand_At_Sensor_Radiance` (Level8) | ~750 m; fades to the mosaic at zoom 8.5→10 | one composite per day | NASA/NOAA, public domain |
| **Clouds (infrared)** overlay, any map style | GIBS `GOES-East/West_ABI_Band13_Clean_Infrared`, `Himawari_AHI_Band13_Clean_Infrared` (Level6) at 50 % opacity | ~2 km; fades out at zoom 7→9 | every 10 min | NOAA / JMA via NASA GIBS, public domain |

How the updating imagery stays current:

- `GET /api/imagery/latest` returns the latest image time per GIBS layer, cached 5 minutes server-side. It asks GIBS's WMTS **DescribeDomains** for each layer (one ~400-byte request, limited to the last 3 days); if that fails it falls back to the full `WMTSCapabilities.xml` (~6 MB, CDN-cached by GIBS for up to 30 minutes).
- GIBS lists a new 10-minute frame while its tiles are still being published one by one (other tiles return 404 for several minutes). The server therefore skips the newest step and uses the newest earlier frame whose world tile is actually served — the label's "n min ago" is honest about this lag.
- Daily composites are built pass by pass, so "today" is partly black; the map uses the **last complete UTC day**.
- Tiles are requested with that explicit time (never GIBS's `default`), so a new time means new tile URLs. The browser re-checks every 5 minutes, **only while the tab is visible** (and once when it becomes visible again). Each new frame gets its own map source under the old one; the old one is removed after the new tiles render, so the swap does not flash.

Limitations:

- **No keyless geostationary imagery over Europe, Africa, the Middle East or the Indian Ocean**: GIBS carries GOES and Himawari but not Meteosat. In live mode those areas show the mosaic, and the label says so.
- Geostationary imagery near the disk edge (high latitudes, far east/west) is heavily stretched.
- Esri and USGS tiles at deep zoom are the *most recent capture available to the provider*, which can be several years old and vary tile to tile. In places without high-resolution coverage, Esri returns a "Map data not yet available" tile.
- Country and state/province boundaries are simplified (~2 km for states), so at street-level zoom they can sit visibly off the imagery; event location-uncertainty rings are hidden above zoom 15.
- **Roads & labels** (hybrid, on by default on satellite): road lines and road/place names from OpenFreeMap (OpenStreetMap) drawn over the imagery from zoom 7 (major roads), 11 (suburbs/villages), 12 (minor roads) and 13 (road names).
- The dark and night-lights map styles stay limited to zoom 14 (the vector tiles' and Black Marble's useful detail); satellite goes to 19 with Esri, 18 with USGS and 16 with zoom detail off.
- **States and provinces**: `npm run geo:regions` builds `public/geo/regions.geojson` from Natural Earth 10m admin-1 (4,596 regions, simplified to ~2 km; ~1.4 MB gzipped). It loads the first time the map is zoomed past level 3; from there, hover and click switch from countries to states/provinces (markets mode stays per-country). The region panel counts the events currently on the map whose location falls inside the boundary.

## Public cameras (`src/layers/cameras`)

Map button **CAM** shows ~28,000 traffic and road-weather cameras that transport agencies publish for public viewing, about 9,500 of them with **live video** (HLS). Clicking a camera fetches its media URLs from `/api/cameras/[id]` and walks a fallback chain: live stream (HLS, via hls.js with network restart and media-error recovery) → video clip (MP4) → still image (re-fetched on the operator's own cadence, every 3 s – 5 min) → a clear "Camera offline" message with Retry. Each step must start within a timeout (12 s for HLS, 10 s for MP4 and stills) and a stream that stalls mid-play gets 15 s to recover, so the viewer never spins forever; the header shows which media type is playing and the footer says why a step was skipped. The still is the poster while a stream connects. A failed still refresh keeps the last good frame. Nothing streams unless a viewer is open: the stream is torn down while the tab is hidden, and closing the viewer removes it entirely. **Video-only** cameras (Maryland, Delaware, Missouri, Oklahoma publish no stills — `imageUrl` is `""` in the row) show "offline" when their stream fails. Media loads directly from the operator; Singapore publishes a new image URL per frame, so its stills are re-resolved through `/api/cameras/[id]` on every refresh.

**Instant list.** The cameras layer is a *background* layer (`background: true` in `src/layers/types.ts`): it loads at server start (`src/instrumentation.ts`) and refreshes at 90 % of its 6 h TTL, so requests never wait on the ~30 upstream feeds (an expired list is served while it refreshes). Each feed gets 25 s; a feed that fails keeps its last good rows (up to 48 h). The API serves a compact list — `[id, name, lon, lat, sourceIndex, flags]` without media URLs (`src/lib/cameras.ts`) — serialised and gzipped once per snapshot with an ETag: ~2.1 MB raw / ~0.53 MB gzip in Oct 2026 (was 4.8 MB / 0.78 MB with URLs).

**Liveness sampling** (`src/layers/cameras/health.ts`). Every 30 min (first round 20 s after the list loads) the server fetches 6 random stills and 6 random stream playlists per source (master + first variant), one request at a time per operator and at most 6 in flight overall; image bodies are cut off after 64 KB. Per-source results are served as `data.health`. A source whose every sample failed is hidden (`data.hidden`), unless most sources fail at once (then it's our network). Cameras get the **live video** flag only when their source's sampled streams are healthy (≥ 50 % responding); otherwise the viewer opens the still first and offers the stream as a tab. DRM-protected streams (`SAMPLE-AES` / FairPlay `skd://` keys) count as failed: browsers can't play them. In Oct 2026 every ALGO Traffic (Alabama) stream is FairPlay-encrypted, so Alabama shows stills.

On the map, live-video cameras are drawn brighter with a white ring; still-only cameras are dimmer. The camera key (shown while **CAM** is on) has a **Live video only** toggle (`settings.camerasLiveOnly`).

**Rules for adding a camera source**

- Only cameras an operator (transport, road or weather agency) publishes for public viewing, from its open data or the public JSON / ArcGIS layer behind its own traveller-information site. Never Insecam-style directories, unprotected IP cameras, search-engine-found devices, residential cameras, third-party aggregators (TrafficLand, EarthCam, YouTube …).
- Keyless only: no API keys, accounts or "request access" APIs; no stream URLs carrying short-lived tokens.
- Image and video URLs must be https (a feed's http link is only upgraded when the operator's host serves the same media over https).
- Live streams must be HLS that a browser can play cross-origin: the playlist **and** the segments must send `Access-Control-Allow-Origin`.
- Respect the operator's terms; skip any source whose terms forbid automated use or that sits behind bot protection.
- Spot-check that image URLs return images and that ~10 sampled playlists return 200 with fetchable segments before adding a source; drop sources where most streams are dead. Cameras the feed marks offline / out of service / problem stream are skipped.

**Liveness** (Oct 2026): for each HLS source, sampled playlists were fetched with an `Origin` header, the variant playlist followed and the newest segment downloaded. "Live" = playlist 200 with segments and a segment returned 200. Every stream that answered also sent `Access-Control-Allow-Origin` (`*`, or the request origin for Indiana) on both playlist and segments, so hls.js can play all of them. Failures were HTTP 404 (stream not running) or timeouts from on-demand stream servers.

| Source (id) | Endpoint | Cameras (Oct 2026) | Live video | Liveness (sampled) | Licence / terms |
| --- | --- | --- | --- | --- | --- |
| Transport for London JamCams (`tfl`) | `api.tfl.gov.uk/Place/Type/JamCam` | ~810 | — (MP4 clips on all) | MP4 10/10 | TfL open data (OGL); image + short MP4 clip |
| NYC DOT (`nyc`) | `webcams.nyctmc.org/api/cameras` | ~975 | — | — | NYC DOT public cameras (stills only; the API has no video URL) |
| Caltrans CCTV (`caltrans`) | `cwwp2.dot.ca.gov/data/dN/cctv/cctvStatusDNN.json` (12 districts) | ~3,400 | ~2,175 (D1, D3–D8, D10–D12) | 78/120 (65 %); D5, D10, D12 8/8, D7 and D11 3/8 | Caltrans public data; image + HLS. District 8's few `http://` / `ttps://` stream links are repaired to https. Dead streams fall back to the still |
| Hong Kong Transport Department (`hk`) | `static.data.gov.hk/td/traffic-snapshot-images/...` (UTF-16 TSV) | ~1,010 | — | — | DATA.GOV.HK terms |
| Fintraffic weathercams (`fi`) | `tie.digitraffic.fi/api/weathercam/v1/stations` | ~810 | — | — | CC BY 4.0 |
| Singapore LTA (`sg`) | `api.data.gov.sg/v1/transport/traffic-images` | ~10 (feed currently small) | — | — | Singapore Open Data Licence |
| Spain DGT (`dgt`) | `nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml` (DATEX II) | ~1,950 | — | — | DGT National Access Point, reuse with attribution (Ley 37/2007) |
| Illinois DOT Gateway (`il`) | ArcGIS `TrafficCamerasTM_Public` (IDOT, paged 1,000 at a time) | ~3,760 | — | — | CC BY-SA 2.0; snapshots flagged `TooOld` (>30 min) are skipped |
| WSDOT (`wsdot`) | ArcGIS `data.wsdot.wa.gov/.../TravelInfoCamerasWeather/FeatureServer/0` | ~1,700 | — | — | WSDOT public data, "low volume" use; only WSDOT- and ODOT TripCheck-hosted frames are kept |
| Iowa DOT (`ia`) | ArcGIS `Traffic_Cameras_View` | ~1,260 | ~700 | 19/20 (95 %) | CC BY 4.0 |
| DriveBC (`bc`) | `www.drivebc.ca/api/webcams/` | ~1,000 | — | — | Open Government Licence – British Columbia; only cameras that are on and not stale |
| Vegagerðin, Iceland (`is`) | `gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1` | ~500 | — | — | Vegagerðin open data, free reuse without conditions |
| City of Toronto (`to`) | Toronto Open Data `traffic-camera-list-4326.geojson` | ~340 | — | — | City of Toronto Open Data portal terms |
| City of Calgary (`cgy`) | `data.calgary.ca/resource/k7p9-kppz.json` | ~215 | — | — | Open Government Licence – City of Calgary |
| Kentucky Transportation Cabinet (`ky`) | ArcGIS `trafficCamerasCur_Prd` | ~245 | — | — | KYTC public layer (no warranty); https TRIMARC snapshots only |
| QLDTraffic, Queensland (`qld`) | `data.qldtraffic.qld.gov.au/webcameras.geojson` (keyless GeoJSON feed) | ~140 | — | — | Queensland TMR, CC BY 4.0 |
| City of Austin (`atx`) | `data.austintexas.gov/resource/b4k4-adkb.json` (Socrata) | ~820 | — | — | City of Austin open data, Public Domain; only cameras with status `TURNED_ON` |
| SD511, South Dakota (`sd`) | `sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson` (the feed behind sd511.org) | ~170 views at ~40 sites | — | — | South Dakota DOT public 511 feed (no warranty); one row per camera view |
| VDOT 511 Virginia (`va`) | `511.vdot.virginia.gov/services/511/map/array/cameras` (the feed behind 511.vdot.virginia.gov) | ~1,715 | ~1,715 | 22/22 (100 %) | VDOT public 511 feed (real-time viewing; VDOT does not record); HLS + thumbnail; inactive / `problem_stream` cameras skipped |
| SC511, South Carolina (`sc`) | `sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson` (the feed behind 511sc.org) | ~795 | ~795 | 20/20 (100 %) | SCDOT public 511 feed (no warranty); HLS + thumbnail |
| Maryland CHART (`md`) | `chart.maryland.gov/DataFeeds/GetCamerasJson` | ~510 | ~510 (video only) | 18/20 (90 %) | Maryland SHA CHART public feed. Stream URL `https://{cctvIp}/rtplive/{id}/playlist.m3u8` as used by CHART's own player; cameras `OFFLINE` or in `COMM_FAILURE` skipped |
| DelDOT, Delaware (`de`) | `tmc.deldot.gov/json/videocamera.json` | ~355 | ~355 (video only) | 20/20 (100 %) | Delaware DOT TMC public feed; `m3u8s` (https) stream; only enabled cameras with status `Active` |
| MoDOT Traveler, Missouri (`mo`) | `traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json` | ~555 | ~555 (video only) | ~39/48 (81 %) | MoDOT public traveller feed; MoDOT (`*-traveler.modot.mo.gov`) and Ozarks Traffic (Springfield) streams. The ~320 KC Scout streams relayed via `traveler.modot.org/tisvc` return HTTP 403 to direct playback and are skipped |
| COtrip, Colorado (`co`) | `cotg.carsprogram.org/cameras_v1/api/cameras` (the feed behind cotrip.org) | ~1,345 views | ~830 | 20/20 (100 %) | CDOT public 511 feed; HLS views with preview still, plus still-only views |
| 511IN / TrafficWise, Indiana (`in`) | `intg.carsprogram.org/cameras_v1/api/cameras` | ~750 | ~750 | 20/20 (100 %) | INDOT public 511 feed; HLS + preview still |
| ALGO Traffic, Alabama (`al`) | `api.algotraffic.com/v4.0/Cameras` (the feed behind algotraffic.com) | ~570 | 0 playable (FairPlay DRM) | stills 6/6; streams 0/6 playable (Oct 2026) | ALDOT public feed; only `accessLevel: Public` cameras; HLS is SAMPLE-AES / FairPlay (not playable in browsers) + snapshot |
| OKTraffic, Oklahoma (`ok`) | `oktraffic.org/api/CameraPoles` (with `mapCameras` + `streamDictionary`) | ~645 | ~645 (video only) | 16/20 (80 %) | ODOT public feed; cameras `Out Of Service` or `blockAtis` skipped |
| KanDrive, Kansas (`ks`) | `kstg.carsprogram.org/cameras_v1/api/cameras` | ~610 | — | — | KDOT public 511 feed; stills only — its streams carry 5-minute tokens, so they are not usable from a 6 h cached list |
| Nebraska 511 (`ne`) | `netg.carsprogram.org/cameras_v1/api/cameras` | ~1,035 views | — | — | Nebraska DOT public 511 feed (stills) |

**Checked and not added** (Oct 2026): IBI-based 511 systems (Ontario, Alberta, Georgia, Florida, Wisconsin, Pennsylvania, Idaho, Nevada, Utah, Louisiana, Alaska) — `/api/v2/get/cameras` needs a key; WSDOT Traveler API — needs an access code (the public ArcGIS layer is used instead); Oregon TripCheck API — needs registration; NZTA traffic cameras — API access is by request to InfoConnect; Norway Statens vegvesen — DATEX node requires registration; Québec 511 — images behind Cloudflare bot protection; NSW Live Traffic — image URLs return an error page; Taiwan freeway CCTV — endpoint unreachable; Newfoundland and Labrador — no licence stated; Germany Autobahn GmbH API — the `services/webcam` endpoint returns no cameras for any motorway; Denmark Vejdirektoratet — webcams withdrawn from the public site, API needs a registered key; North Carolina TIMS API — retired in favour of an IBI-style DriveNC endpoint; New Mexico NMRoads — snapshots served over http only; Main Roads Western Australia — no camera layer in the keyless open-data services; Slovenia promet.si / NAP and Estonia Tark tee — portal unreachable within the time limit or registration-based (not added); Sweden Trafikverket, Czechia, Estonia DATEX — registration required. **Live video, checked and not added:** New York State 511NY — cameras (and their video URLs) only through the keyed 511NY API, and data.ny.gov has no camera dataset; NYC DOT — the public camera API publishes stills only, no video URL; Tennessee SmartWay — camera API needs an API key; Massachusetts (Mass511 via CARS) — video is a TrafficLand relay with an embedded key (third-party aggregator); Kansas KanDrive streams — short-lived tokens (stills kept); KC Scout (Kansas City) streams via MoDOT — HTTP 403 for direct playback; Washington DC HSEMA Skyline layer — staging player page, not an HLS URL; Mississippi MDOTtraffic — streams only inside per-camera HTML pages; Georgia, Florida, Pennsylvania, Arizona, Louisiana, Wisconsin, Utah, Nevada, Connecticut (IBI 511) — keyed API; Minnesota 511 (CARS) — camera list returned empty.

## Space overlays (`src/layers/iss`, `src/layers/aurora`)

Map buttons **ISS** and **AUR** are independent of the map mode (like **CAM**), off by default, and fetch only while switched on. Both go through `/api/layers/:id`, so every browser shares one server-side cached copy and never calls the upstream directly. Polling pauses while the tab is hidden.

| ID | Source | Cache | Key | What it shows |
| --- | --- | --- | --- | --- |
| `iss` | [wheretheiss.at](https://wheretheiss.at/w/developer) `/v1/satellites/25544` and `/positions?timestamps=…` | position 5 s, track 5 min | — | Station marker (polled every 5 s) and ground track ±90 min: past solid, next 90 min dashed. Popup: altitude, speed, whether the station is sunlit or in Earth's shadow, and whether it is day or night on the ground below (from the API's sub-solar point). |
| `aurora` | [NOAA SWPC OVATION Prime](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast) `ovation_aurora_latest.json` | 10 min | — | Probability of visible aurora on a 1° grid; cells ≥ 10 % drawn as soft circles (green → red). The legend shows the forecast-valid time and model run time. |

- **Computed and forecast, not observed.** ISS positions and the track are computed by wheretheiss.at from the latest published orbital elements (TLE); the legend and popup say so. OVATION is a short-range model forecast (~30–90 min ahead), labelled "forecast" everywhere.
- **Etiquette.** wheretheiss.at allows 350 requests per 5 minutes. One cached position per 5 s plus a 61-point track (7 requests of ≤ 10 timestamps, the documented maximum) every 5 minutes uses about 67. The track refreshes in the background, so a failure keeps the last track and never hides the position.
- **Day/night** comes from the existing terminator layer; the ISS overlay does not draw its own.
- **Considered but not used:** CelesTrak TLEs + client-side SGP4 (would add a propagation library for no visible gain over wheretheiss.at's computed positions); Open Notify `iss-now.json` (HTTP only, no altitude/speed/track); a MapLibre heatmap for aurora (heatmap intensity reflects point density, not the forecast probability, so graduated circles are used instead); SWPC 3-day Kp forecast (global index, not a map).

## Strategic infrastructure (`src/lib/infra`, `npm run geo:infra`)

Map button **INF** opens the infrastructure panel: ten independent toggles (persisted, independent of map modes), keys, the chokepoint monitor and the sources below. The layers are static extracts built once by `scripts/build-infra.ts` into `public/geo/infra/*.geojson` (committed, ~4.5 MB raw, ~0.8 MB gzipped in total; `meta.json` records counts and build time). Each file is fetched the first time its layer is switched on. The OSM-derived files are extracts of OpenStreetMap and stay under ODbL; the map shows the matching attribution while a layer is visible. Rebuild everything with `npm run geo:infra`, or some files with e.g. `npm run geo:infra -- ports power-plants`.

| Layer | File | Source | Licence | Count | Size (raw / gzip) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Subsea cables | `cables` | OpenStreetMap via Overpass: ways with `communication=line` + `location=underwater/submarine` or `submarine=yes`, `telecom=cable` underwater, and `seamark:type=cable_submarine` with a telephone/fibre-optic category; power cables excluded | ODbL 1.0 | 707 | 183 KB / 44 KB | Simplified to ~1 km. **Partial**: OSM maps only part of the global network (mostly trans-Atlantic, European and some Asian systems). |
| Landing points | `landing-points` | OSM landing stations (`telecom~landing`, `building=cable_landing_station`, names containing "cable landing") plus ends of cables ≥ 5 km that lie on or within ~6 km of land (bundled country polygons), merged within 5 km | ODbL 1.0 | 366 (52 mapped stations) | 51 KB / 7 KB | Derived points are labelled "cable end at the coast". |
| Power plants / Nuclear | `power-plants` | [WRI Global Power Plant Database v1.3](https://datasets.wri.org/dataset/globalpowerplantdatabase) | CC BY 4.0 | 13,876 (plants ≥ 30 MW, plus all 195 nuclear) | 2.1 MB / 330 KB | Last updated 2021. Coloured by primary fuel; the Nuclear toggle shows the same file filtered to nuclear. |
| Oil & gas pipelines | `pipelines` | OSM `type=route` + `route=pipeline` relations; substance from `substance=*`, or from the name (gas/oil/нефт/газ/…) when untagged; water, sewage, heat etc. dropped; ≥ 10 km | ODbL 1.0 | 396 (276 gas, 90 oil, 30 refined products) | 443 KB / 117 KB | Simplified to ~2 km. **Not exhaustive** — only pipelines mapped as route relations. |
| LNG terminals | `lng` | OSM `industrial=lng_terminal`, industrial areas named "LNG" and LNG storage tanks (merged within 5 km) + NGA World Port Index ports with an LNG terminal facility not already within 10 km | ODbL 1.0 + public domain | 223 (192 OSM, 31 WPI) | 27 KB / 5 KB | |
| Ports | `ports` | [NGA World Port Index (Pub. 150)](https://msi.nga.mil/Publications/WPI) `UpdatedPub150.csv` | Public domain (U.S. Government) | 3,807 | 543 KB / 79 KB | Sized by harbour size; popup lists oil/LNG terminal flags and UN/LOCODE. |
| Data centres | `datacenters` | OSM `telecom=data_center` (nodes, ways, relations at their centre), de-duplicated within 300 m | ODbL 1.0 | 3,198 | 469 KB / 87 KB | |
| Military bases | `bases` | OSM `military=base` / `military=naval_base`, de-duplicated within 1 km | ODbL 1.0 | 4,748 (394 naval) | 716 KB / 126 KB | Only what is publicly mapped in OSM; ~1,500 are unnamed. Shown factually (name, type, operator if tagged). |
| Chokepoints | — | Curated list in `src/lib/infra/chokepoints.ts`: Hormuz, Bab el-Mandeb, Suez, Malacca, Bosporus, Panama, Gibraltar, Taiwan Strait, Kerch, Dover, Danish straits, Lombok, Cape of Good Hope | Apache-2.0 (this project) | 13 | — | Hand-placed centres and monitoring radii (50–300 km). |

**Chokepoint monitor** — `GET /api/infra/chokepoints?days=7` (1–30 days, cached 2 min) finds WorldView events within each chokepoint's radius via the repository's `findNear`, skipping country-precision events (they sit at a country centroid, not at the strait). Disruption score 0–100 = `100 × (1 − e^(−Σw/3))` with `w = importance/100 × category weight × 0.5^(age/48 h)`; category weights: conflict 1.5, maritime 1.3, infrastructure 1.0, disaster 0.9, weather 0.8, protest/earthquake/flood 0.6, politics 0.5, news 0.4, other 0.3. Levels: calm < 15 ≤ watch < 35 ≤ elevated < 60 ≤ high. It measures reported events near the strait, **not** shipping traffic. The panel lists every chokepoint (events · score); click to fly there. The map colours each radius by level.

- **Considered but not used:** TeleGeography Submarine Cable Map (`submarinecablemap.com/api/v3/…`) — reachable, but its data is commercially licensed (the CC BY-SA 4.0 grant covers map images/screen captures, not the underlying data), and the old CC BY-NC-SA GitHub repo was removed. Global Energy Monitor trackers (CC BY 4.0) — downloads require submitting a request form with personal details, so not keyless. OSM `man_made=pipeline` ways (60,000+ named oil/gas ways, far too large and mostly distribution lines). WPI alone for LNG (only 41 ports flagged).

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

## Country profile (`src/lib/country-profile`)

Clicking a country → **Profile** in the country overview (`GET /api/countries/:code/profile`). Each stat shows its value, period and source; hovering shows the series name. Missing values are left out, never shown as 0. For each stat the most recent period wins; ties go to the more specific source (Eurostat > OECD > World Bank > IMF > FRED). Wikidata numbers only fill gaps no official source covers, are starred and labelled as community data. All sources are keyless and fetched in parallel; one failing source doesn't affect the others, and the panel lists which ones were unavailable. Profiles are cached 24 h per country (30 min if a source failed).

| Source | Endpoint | Coverage | Stats |
| --- | --- | --- | --- |
| World Bank Indicators API | `api.worldbank.org/v2/country/{iso3}/indicator/{ids}?source=2&mrnev=1` | ~215 economies, annual | Population, GDP (current US$), GDP per capita, real GDP growth, CPI inflation, unemployment (ILO modelled), current account % GDP |
| IMF DataMapper (World Economic Outlook) | `imf.org/external/datamapper/api/v1/{indicator}` (returns every country; each indicator cached 24 h and shared) | ~195 economies, annual | General government gross debt % GDP; fallbacks for growth, inflation, unemployment, current account, GDP, GDP per capita and population (e.g. Taiwan, Liechtenstein). Projection years after last year are ignored; the latest year can still be an IMF estimate. The IMF CDN sometimes answers 403 to bursts; the profile then shows it as unavailable |
| Eurostat dissemination API (JSON-stat 2.0) | `ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}` | EU 27 + Iceland, Norway, Switzerland, Liechtenstein | HICP inflation (`prc_hicp_minr`, monthly; `prc_hicp_manr` stopped at 2025-12), unemployment (`une_rt_m`, s.a.), government debt % GDP (`gov_10q_ggdebt`, quarterly), 10-year convergence bond yield (`irt_lt_mcby_m`). Greece is `EL` |
| OECD SDMX, Key Short-Term Economic Indicators | `sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_KEI@DF_KEI,4.0/.M.CP+UNEMP+IRLT+IR3TIB.....?lastNObservations=1` | OECD members plus AR, BR, CN, ID, IN, RU, SA, ZA, monthly | CPI year-on-year, unemployment (s.a.), 3-month interbank rate, long-term (10-year) government bond yield. The API allows only a few dozen requests per hour per IP, so one all-country request is made per day |
| FRED (`fredgraph.csv`) | `IRLTLT01{XX}M156N`, `IR3TIB01{XX}M156N` | As OECD | Fallback for the two interest-rate series, used only when the OECD endpoint fails |
| Wikidata SPARQL (community data) | `query.wikidata.org/sparql` (POST, descriptive User-Agent) | All countries with an ISO 3166-1 code | Capital, currency (ISO 4217), head of state, head of government (current, preferred-rank statements with no end date), HDI; population, GDP and GDP per capita (US$ only) as fallbacks. Reads both `en` and language-neutral `mul` labels, since many items (e.g. euro, Emmanuel Macron) now have only the latter |

Notes: the short rate is a 3-month interbank rate, not the central bank policy rate (no keyless cross-country policy-rate source was found; euro-area countries share one rate). World Bank "unemployment" is the ILO modelled estimate. Government debt is general government gross debt (IMF/Eurostat); the World Bank central-government debt series is not used because it measures something different.

## Live layers (`src/layers/`)

Live layers are continuously changing observations visualised in map modes. They are **not events**: they never enter the event store, scoring or deduplication. Each is fetched on demand through `/api/layers/:id` and cached server-side for its TTL, so upstream quotas are only used while someone is looking, and every client shares one cached copy. If an upstream fetch fails, the last good snapshot is served with `stale: true` (shown in the legend).

| ID | Source | Mode | Cache | Key | Notes |
| --- | --- | --- | --- | --- | --- |
| `weather-radar` | [RainViewer](https://www.rainviewer.com/api.html) weather-maps index + tiles | Weather | 5 min | — | 13 past frames (2 h) + nowcast; coverage only where national radar networks share data; attribution required |
| `aviation` | [OpenSky Network](https://opensky-network.org/) `/states/all` | Aviation | 20 min | optional `OPENSKY_CLIENT_ID/SECRET` | Anonymous quota is 400 credits/day; a global snapshot costs 4, so the 20-min cache keeps continuous use under ~290/day. Positions older than 2 min are dropped. Non-commercial use terms apply |
| `maritime` | With a key: [AISStream.io](https://aisstream.io/) websocket. Without: [Fintraffic Digitraffic marine](https://www.digitraffic.fi/en/marine-traffic/) `meri.digitraffic.fi/api/ais/v1/locations` + `/vessels` | Maritime, and map button **SHIP** (any mode) | 1 min (vessel metadata 30 min) | optional `AISSTREAM_API_KEY` (free) | AISStream: a websocket stays open while the layer is used (closed after 10 idle minutes); latest position per vessel, last 30 min; terrestrial AIS is sparse in open ocean. Digitraffic: keyless, **CC BY 4.0** ("Source: Fintraffic / digitraffic.fi"), requests carry the required `Digitraffic-User` header; Finnish coastal receivers only (Gulf of Finland, Gulf of Bothnia, northern Baltic — ~800–1,000 vessels), positions from the last 60 min joined with name, AIS ship type and destination |
| `military-aircraft` | [adsb.lol](https://api.adsb.lol/docs) `/v2/mil` | Map button **MIL** (any mode) | 30 s | — | Aircraft broadcasting ADS-B **identified as military in the community database** (~200 at a time); data under **ODbL 1.0**. Most military aircraft do not broadcast, so this is never complete; positions older than 2 min dropped. `/v2/ladd` and `/v2/pia` (privacy-program aircraft) deliberately not used |
| `satellites` | [CelesTrak](https://celestrak.org/NORAD/elements/) GP data (OMM JSON): groups `stations`, `gps-ops`, `visual` | Map button **SAT·ORB** (any mode) | 2 h | — | See [Satellites](#satellites-srclayerssatellites) |
| `iss` | [wheretheiss.at](https://wheretheiss.at/w/developer) | Map button **ISS** (any mode) | 5 s (track 5 min) | — | See [Space overlays](#space-overlays-srclayersiss-srclayersaurora) |
| `aurora` | [NOAA SWPC OVATION](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast) | Map button **AUR** (any mode) | 10 min | — | Forecast, not observation |

### Satellites (`src/layers/satellites`)

- **Elements**: CelesTrak GP data, keyless. CelesTrak refreshes GP data about every 2 hours and asks clients not to re-download unchanged data, so the server fetches three groups (`stations`, `gps-ops`, `visual`) at most once per 2 h and every browser shares that copy. Capped at 40 stations, 40 GPS and 200 "visual" (brightest) objects (~200 in practice); duplicate NORAD ids and objects sharing identical elements (ISS modules) are dropped. Attribution: "Orbital elements: CelesTrak".
- **Propagation**: positions are computed **in the browser** every 2 s with a bundled SGP4 (`sgp4.ts`, the near-Earth branch of Vallado et al. 2006, WGS-72; `satellite.js` is not a dependency). It reproduces the Spacetrack Report #3 reference vectors to within a few metres (see `tests/live-tracking.test.ts`) and agrees with wheretheiss.at's ISS position to ~1 km. **Deep-space objects** (period ≥ 225 min, e.g. GPS) use the same model without the SDP4 lunisolar/resonance terms — tens of km near the element epoch, fine for a globe, not for precise work.
- **Orbit track**: click a satellite to draw its ground track (past half orbit faint, next full orbit bright), recomputed every 30 s. These are model positions, not observations.

### GPS jamming — not added

[gpsjam.org](https://gpsjam.org/) does publish daily files (`gpsjam.org/data/YYYY-MM-DD-h3_4.csv`: H3 resolution-4 hex, good/bad aircraft counts, with a `manifest.csv`). They are **not used** because neither the site, its FAQ nor the files state any licence or permission for reuse — the map is "free to use", but redistributing the data in another app is not granted — and the data is derived from third-party ADS-B aggregator feeds whose own terms apply. Rendering H3 cells would also need `h3-js`, which is not a dependency. Revisit if the author publishes terms.

Adding a layer: create `src/layers/<id>/` with a `LiveLayerProvider` (`load()` returns a snapshot), register it in `src/layers/registry.ts`, add a mode in `src/lib/map-modes.ts` and its map layers in `src/components/globe/layers.ts`.

## Reference geography (bundled, `npm run geo:build`)

Natural Earth countries (1:50m), populated places, and admin-1 states/provinces (label points + local/alternate names); OurAirports large/medium airports. All public domain.

## Place search (geocoding)

⌘K search has a **Places** group (`src/lib/geo/place-search.ts`, `src/lib/geo/place-index.ts`, `src/lib/geo/geocode.ts`):

- **Instant, offline**: countries, continents, admin-1 states/provinces (ids match `public/geo/regions.geojson`, so picking one opens the region panel), cities and airports (IATA/ICAO codes and names) from the bundled reference geography above, returned with `/api/search`. Typed coordinates (decimal, hemisphere letters or degrees-minutes-seconds) are parsed in the browser.
- **Online**: [Photon](https://photon.komoot.io/) by komoot — keyless OpenStreetMap geocoder that allows type-ahead under fair use — for addresses, landmarks, neighbourhoods and small towns. The browser calls our `/api/geocode` proxy (≥ 3 characters, 300 ms debounce); the server sends a descriptive `User-Agent`, caches each query for 24 h (up to 2,000 queries in memory), and rate-limits to 40 requests/min per client and 60 upstream calls/min overall (HTTP 429 beyond that). Results are labelled "OSM" and attributed: *Search by Photon (komoot), data © OpenStreetMap contributors* (ODbL).
- **Camera**: countries and states fit their bounding box; cities fly to zoom 10; addresses and points of interest to zoom 16 (large ones like parks fit their extent). A temporary pin marks the result until the next search or a map click.
- **Not used**: `nominatim.openstreetmap.org` — its usage policy forbids autocomplete/type-ahead. Photon results are OSM data and can be incomplete or ambiguous (several "Eiffel Tower"s); the detail line shows town and country to tell them apart.

## Considered but not used

- **ReliefWeb API** now requires a pre-approved app name (v2 returns 403 without one; v1 is decommissioned, 410). Its RSS feeds answer 406 to non-browser clients.
- **NHTSA vehicle recalls**: no keyless "recent recalls" feed — the API needs make/model/year and the RSS page returns 403.
- **US State Department press releases RSS** returns 403 to automated clients.
- **Smithsonian GVP weekly volcano RSS** (`volcano.si.edu/news/WeeklyVolcanoRSS.xml`) and the weekly-report page block programmatic access (403, rechecked Oct 2026). Volcanic ash SIGMETs (`volcanic-ash`) cover erupting volcanoes instead.
- **Stooq** no longer serves quote CSVs.
- **Polymarket** (prediction markets) API timed out.
- **SEC EDGAR "current filings" Form 4 feed** was once refused; with a User-Agent carrying `WORLDVIEW_CONTACT` it answers, and is used by `sec-insider-buys`.
- **NGA Maritime Safety Information** (`msi.nga.mil`): the ASAM (piracy / anti-shipping) endpoint `api/publications/asam` returns 404, and the NAVAREA broadcast-warning API is frozen (newest warning May 2024 at Oct 2026). Other maritime-security feeds checked — UKMTO, MARAD MSCI advisories — answer 403 to an identified client.
- **Aviation Safety Network** accident RSS answers 403 to WorldView's identified client; **The Aviation Herald** RSS URL returns an HTML page, not a feed. No keyless air-accident feed is ingested.
- **FAO Food Price Index** CSV at its documented URL stopped updating in 2018 (newer releases are Excel/HTML only); **US Drought Monitor** publishes weekly area statistics, not discrete events. Neither is ingested.
- **Launch Library 2** upcoming launches are already covered by `space` (±7 days); not added again.
- **Fiscal Data `auctions_query`** fills in auction results only days after the auction; `treasury-auctions` reads TreasuryDirect's same-day web service instead.
- **Nasdaq earnings calendar** API blocks non-browser clients.
- **GeoNet (NZ) volcanic alert levels** carry no timestamp, so they can't be placed in time without inventing one.
- **OFAC recent actions** page/RSS: OFAC's only RSS (`ofac.treasury.gov/rss.xml`) lists sanctions-program pages, not recent actions, and the recent-actions page is HTML only. Sanctions list changes come from the Sanctions List Service instead (`ofac-sanctions`).
- **UK OFSI** news feed is too infrequent (latest item mid-2025); UK sanctions announcements come from the GOV.UK search feed (`sanctions-news`).
- **Norwegian Coastal Administration (Kystverket) open AIS** is a raw NMEA TCP stream (`153.44.253.27:5631`), not HTTP/JSON; connections from here timed out, and using it would need an AIVDM decoder and a long-lived socket. Other keyless AIS (AISHub, MarineTraffic, VesselFinder) require an account, a feeding station or a commercial licence; Danish DMA AIS is published only as daily historical CSV archives.
- **gpsjam.org** daily GPS-interference hexes: no stated licence (see [GPS jamming](#gps-jamming--not-added)).
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
