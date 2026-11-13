# WorldView — handoff guide (for people and AI coding agents)

Read this first if you're picking the project up on a new machine or with a new coding agent
(Antigravity, Claude Code, Cursor…). It explains what WorldView is, how to run it, how the code is
laid out, the rules the project follows, and what's left to do. Details live in `README.md` and
`docs/`.

> **AI agents:** also read `AGENTS.md` (this Next.js version differs from your training data — read
> `node_modules/next/dist/docs/` before writing Next.js code) and follow **Project rules** below.

---

## 1. What it is

WorldView is a local "world intelligence + markets terminal": a 3D globe of live world events plus
Bloomberg-style market pages and an AI analyst, built only from **free, public, keyless** data.

- **88 data sources** feeding one event store: disasters, weather, conflict, news (42 outlets + GDELT),
  official agencies (central banks, sanctions, SEC, DOJ, FDA, FEMA, UN, EU…), outages, cyber,
  aviation, space weather and more. Full list: `docs/DATA_SOURCES.md`.
- **Pages** (left rail): World (globe), News, Countries, Markets, Charts, Analyst, Briefing, Planet, Energy,
  Security, Trends, Sources. The globe is only mounted on World.
- **Plot anything**: searchable sidebar to put any source, live-tracking feed (ships, aircraft,
  military aircraft, satellites, ISS, aurora, cameras), infrastructure layer or map style on the globe.
- **Drop in**: Google-Earth-style 3D street level (terrain, 3D buildings, orbit, nearby photos).
- **Markets**: quotes, macro (FRED), futures curves, CFTC, crypto, prediction markets, company
  profiles (SEC XBRL), 10-K AI analysis, 13F fund holdings, insider trades (Form 4), dividends, short
  volume, earnings calendar, a stock-setups screen with a scorecard and backtest.
- **AI analyst**: answers any question — 41 tools over all the app's data, general knowledge for
  explanations, researched stock ideas with an honest track record. Runs on-device (Gemma 4 E2B via
  llama.cpp) or on Anthropic if a key is set.
- **Alerts**: Discord webhook (daily briefing, major events, watchlist moves, earnings, market-close
  wrap, stock setups, weekly scorecard), macOS notifications.
- **macOS extras**: native app (`mac/`), menu-bar ticker, always-on service, battery mode.

Credit: built by **akshng** (Apache-2.0). Never put the author's real name anywhere.

## 2. Run it on a new machine (Windows, Linux or Mac)

Requirements: **Node.js 22+** (developed on Node 24), npm, git, ~6 GB disk (the AI model is 3.1 GB).

```bash
git clone https://github.com/akshng/worldview.git
cd worldview
npm install
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
npm run dev                       # http://localhost:3000
```

Then fill in `.env.local` (it is git-ignored — never commit it). The two values worth setting:

| Variable | Why |
|---|---|
| `WORLDVIEW_CONTACT` | An email address. SEC EDGAR requires a contact in the User-Agent; without it the 10-K text, 13F, Form 4, insider-buy and 13D features fall back or skip. |
| `DISCORD_WEBHOOK_URL` | Optional. Your Discord channel's webhook URL (Server Settings → Integrations → Webhooks). Keep it secret. |

Everything else has working defaults (see `.env.example`, every variable is documented there).

- **Local AI model:** downloads automatically on first AI use, or ahead of time with `npm run ai:setup`
  (Gemma 4 E2B, ~3.1 GB, into `.data/models/`). On Windows/Linux node-llama-cpp uses CUDA or Vulkan
  if available, otherwise the CPU (slower but works).
- **Data:** `.data/` (event store, caches, model) is not in git. It rebuilds itself as sources run;
  the first few minutes after a fresh start show less data.
- **Production build:** `npm run build && npm start`.

### What's macOS-only (and what to use instead)

| macOS feature | Files | On Windows / Linux |
|---|---|---|
| Always-on service (LaunchAgent) | `scripts/local-service.mjs` | Run `npm run build && npm start` under a process manager (e.g. `pm2`, a Windows service via NSSM, or systemd on Linux). |
| Morning briefing / after-close jobs / battery sentinel schedules | `scripts/schedule-briefing.mjs`, `scripts/power-mode.mjs` | The jobs themselves are cross-platform (`npm run briefing:morning`, `npm run close:run`, `npm run sentinel`). **Windows:** `npm run windows:schedule` installs them in Task Scheduler for your user, no admin (`-- 06:45` for another briefing time, `-- --sentinel` to add the 15-minute sentinel; `npm run windows:unschedule` removes them; logs in `.data\*.log`). **Linux:** cron. |
| Battery mode / power watcher | `scripts/power-watch.sh` | Not needed on a desktop PC. The page itself still slows down on battery in Chrome (Battery API). |
| Native app + menu-bar ticker | `mac/`, `npm run mac:build` | Use the browser (or install it as a PWA from Chrome/Edge). |
| Mac notifications | `src/lib/notify/mac.ts` | Off automatically elsewhere; use Discord alerts. |

## 3. Everyday commands

```bash
npm run dev          # dev server (Turbopack) on :3000
npm test             # vitest — 645 tests, all must pass
npm run lint         # eslint — 0 errors (3 known warnings)
npx tsc --noEmit     # typecheck (run `npx next typegen` first on a fresh clone if route types are missing)
npm run build        # production build — must say "Compiled successfully" with no "Type error"
```

CI (`.github/workflows/ci.yml`) runs typegen, typecheck, lint, tests and build on Ubuntu and Windows
with Node 22 and 24, without `.env.local` or secrets. `.github/workflows/security.yml` runs
`npm audit --omit=dev --audit-level=high`, gitleaks (`.gitleaks.toml`) and
`.github/scripts/check-personal-info.mjs`; Dependabot proposes npm and Actions updates weekly.
Contribution rules: `CONTRIBUTING.md`; vulnerability reports: `SECURITY.md`.

Before finishing any change: **typecheck, lint, tests and build all green.** Only restart a running
production server after a successful build (a failed build + restart leaves no server).

## 4. Code map

```
src/
  app/                    Next.js App Router pages and API routes (src/app/api/**/route.ts)
  components/
    layout/               App shell: Dashboard (pages), NavRail, NewsPage, CountriesPage, SourcesPage
    globe/                MapLibre globe (Globe.tsx), style.ts, drop-in hook (use-drop-in.ts)
    dropin/               Drop-in HUD, photos strip, pure logic
    sidebar/              Sidebar + PlotPanel ("plot anything")
    markets/ analyst/ briefing/ planet/ energy/ security/ trends/ …   one folder per page/panel
  data-sources/           One folder per connector + registry.ts (see "Add a data source")
    official-common.ts    shared helpers for official feeds; agency-feeds/common.ts for RSS agencies
  layers/                 Live map layers (ships, aircraft, military, ISS, satellites, aurora, cameras…)
  lib/
    analyst/              AI analyst: tools.ts (41 tools), router.ts (question → tools), agent.ts,
                          prompts.ts, ideas-answer.ts (assembled buy answers), world-data.ts
    ai/                   AI providers (local Gemma via node-llama-cpp, Anthropic) and prompts
    finance/              market data, SEC (company, 13F, Form 4, 10-K analysis), setups + scorecard,
                          earnings calendar, Google News headlines, stock research
    notify/               Discord (discord.ts, discord-server.ts, watch.ts, sentinel.ts), macOS
    events/ ingestion/    event model, scoring, dedup pipeline
    server/               server context (scheduler), http helpers, watchlist store
    store/ui.ts           zustand UI store (pages, filters, plot, drop-in state)
    client/               client hooks (live data, power/battery, app bridge, API client)
  types/events.ts         EventCandidate / WorldEvent / EventSummary schemas
scripts/                  run-once jobs (morning briefing, close jobs, sentinel), schedulers, mac build
mac/                      native macOS app (Swift, WebKit) and icon
docs/                     ARCHITECTURE, DATA_SOURCES, EVENT_MODEL, FINANCE, DEVELOPMENT
tests/                    vitest suites
```

## 5. Project rules (follow these)

1. **Free, public, keyless data only** unless the owner explicitly adds a key. Paid or keyed options
   may be offered, never assumed.
2. **Honest clients.** Every request uses the app's real User-Agent (`userAgent()` / `ctx.userAgent`).
   **Never** disguise the client as a browser, rotate identities, or get around bot checks, rate
   limits or access controls. If a source refuses the honest client, skip it and note it under
   "Considered but not used" in `docs/DATA_SOURCES.md`. Respect rate limits (SEC ≤ 10 req/s).
3. **Facts vs. AI.** Facts come from sources and link back to them. AI output is always labelled as
   interpretation. The analyst never invents current numbers; general-knowledge answers are labelled.
   Stock ideas are a rule-based screen with their real (currently weak) track record shown — no price
   targets, position sizes or certainty.
4. **Privacy.** Nothing personal in git: no real name (credit "akshng" only), no email addresses, no
   webhook URLs or keys. Secrets live in `.env.local` only. Commits use
   `git -c user.name=akshng -c user.email=69411132+akshng@users.noreply.github.com commit`.
5. **Battery and resources.** Scheduled work runs as run-once jobs that unload the AI model and exit.
   Nothing heavy loads unless it's used (globe only on World, terrain only while dropped in, AI
   unloads after 2 idle minutes). Background updates slow down on battery and pause when unfocused.
6. **Quality bar.** Every connector/parser/tool gets vitest tests with inline fixtures. Keep
   typecheck, lint (0 errors), tests and build green. Verify UI changes in a browser.
7. **Small local model.** The on-device model is good at writing and poor at reasoning over many
   facts. Where correctness matters (verdicts, track records, picks), compute it in code and let the
   model only phrase it (see `src/lib/analyst/ideas-answer.ts`, `src/lib/finance/research-take.ts`).

### Security model (local app, no login)

- `src/proxy.ts` guards every `/api` route: the `Host` must be a loopback name (blocks DNS
  rebinding and other devices), and browser requests labelled `Sec-Fetch-Site: cross-site` /
  `same-site` are refused (blocks other websites from posting to Discord, starting AI jobs or
  changing the watchlist). The app sends `same-origin`; scripts and curl send nothing and pass.
- `isAdminRequest` (`src/lib/server/http.ts`) applies the same rules (or `ADMIN_TOKEN` when set).
  Don't use `req.url`'s hostname for trust: Next fills it from the bind address.
- `npm run dev` / `npm start` bind to 127.0.0.1. `next/image` is disabled (unused).
- Keep `npm audit --omit=dev` at 0 and Next.js patched.
- Vulnerability reports go through GitHub private vulnerability reporting (see `SECURITY.md`).

## 6. How to extend it

- **Add a data source:** create `src/data-sources/<id>/` implementing `DataSourceConnector`
  (`fetch(ctx)` + `parse(raw, ctx)` → `EventCandidate`s; see `types.ts` and recent connectors such as
  `nasdaq-halts`, `ifrc-appeals`, `faa-tfr`), register it in `registry.ts`, add a row to
  `docs/DATA_SOURCES.md`, add tests. Then let the analyst reach it: add a route in
  `src/lib/analyst/router.ts` (topic regex → `search_events` with `source: "<id>"`) and add the id to
  the `source` description in `src/lib/analyst/tools.ts`.
- **Add an analyst tool:** add a `ToolDef` in `src/lib/analyst/tools.ts`, a dependency in `ToolDeps`
  (+ real implementation in `deps.ts`, mock in `tests/analyst.test.ts`), and routing in `router.ts`.
- **Add a page:** add the id to `APP_VIEWS` in `src/lib/store/ui.ts`, an entry in
  `src/components/layout/NavRail.tsx`, and render it in `Dashboard.tsx` inside the page area.
  Existing panels render as pages via `usePageMode()`.
- **Event enrichments** (`src/lib/enrich/`, routes under `src/app/api/enrich/`): on-demand context for
  an open event — USGS ShakeMap/PAGER/DYFI (`usgs.ts` parsers, `ShakingImpact.tsx`, globe overlay
  `ShakeMapOverlay.tsx` driven by `useShakeOverlay` in `client.ts`) and Open-Meteo point weather
  (`weather.ts`, `WeatherCard.tsx`, also in the drop-in HUD). `server.ts` has the TTL cache (negative
  results cached 2 min) and the honest fetcher; product URLs are only followed on earthquake.usgs.gov.
  Add a new enrichment the same way: pure parser + tests, cached server route, lazy client hook.
- **Add a map overlay:** live layers live in `src/layers/` (provider + `/api/layers/[id]`); toggles
  go in `PlotPanel.tsx`.

## 7. Current state (2026-11)

Working and deployed on the owner's Mac: everything listed in section 1. 645 tests passing.

Known caveats:
- `src/components/globe/use-drop-in.ts` patches a MapLibre internal (feature-query scale at high
  pitch) so markers stay clickable while dropped in — re-check when upgrading `maplibre-gl`.
- Free ship tracking is thin in many regions (Open Waters AIS + Nordic feeds).
- The stock-setups screen shows no reliable edge in its backtest; the scorecard keeps measuring it.
- Some sources are skipped because they refuse honest automated clients or need keys (listed in
  `docs/DATA_SOURCES.md`): ISW, OPEC, IEA, BLS, IMF, ReliefWeb, Aviation Safety Network, UKMTO,
  ransomware.live (disabled), and others.
- SEC endpoints occasionally answer 403 "rate threshold" when hit hard; set `WORLDVIEW_CONTACT`.

Ideas for next steps:
- More keyless sources (see the candidate lists in `docs/DATA_SOURCES.md`); NOAA SWPC is done.
- Hosted/multi-user version (would need licensed market data — several free sources are personal-use).
- Better 3D only if a key is added (Cesium ion / Google Photorealistic 3D Tiles); keyless is near
  MapLibre's limit.
