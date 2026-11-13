# Contributing to WorldView

Thanks for helping. WorldView is a local world-intelligence and markets terminal built only from
free, public, keyless data. Start with [HANDOFF.md](HANDOFF.md) for the code map and
[README.md](README.md) / [docs/](docs/) for details.

> **Coding agents:** also read `AGENTS.md`. This Next.js version differs from older ones; read the
> guides in `node_modules/next/dist/docs/` before writing Next.js code.

## Setup

Requirements: Node.js 22+ (developed on Node 24), npm, git.

```bash
git clone https://github.com/akshng/worldview.git
cd worldview
npm install
cp .env.example .env.local      # optional; Windows PowerShell: Copy-Item .env.example .env.local
npx next typegen                # route types for the typecheck on a fresh clone
npm run dev                     # http://localhost:3000
```

No keys are needed. The on-device AI model (~3.1 GB) downloads on first AI use or with
`npm run ai:setup`. Set `NODE_LLAMA_CPP_SKIP_DOWNLOAD=true` before `npm install` if you don't need
the AI (CI does this).

## Checks (all must pass before a PR)

```bash
npx tsc --noEmit     # typecheck
npm run lint         # 0 errors
npm test             # vitest
npm run build        # "Compiled successfully", no "Type error"
node .github/scripts/check-personal-info.mjs   # no emails or personal info in tracked files
```

CI runs the same on Ubuntu and Windows with Node 22 and 24, plus `npm audit --omit=dev`, gitleaks
secret scanning and the personal-information check. The app must build and test **without**
`.env.local` or any secret.

## Project rules

1. **Free, public, keyless data only.** Paid or keyed options may be offered as optional extras,
   never required.
2. **Honest clients.** Every request uses the app's real User-Agent (`userAgent()` /
   `ctx.userAgent`). Never disguise the client as a browser, rotate identities, or get around bot
   checks, CAPTCHAs, rate limits or access controls. If a source refuses the honest client, skip it
   and note it under "Considered but not used" in `docs/DATA_SOURCES.md`. Respect rate limits
   (SEC ≤ 10 requests/s).
3. **Facts vs. AI.** Facts come from sources and link back to them. AI output is always labelled
   as interpretation; the analyst never invents current numbers. Stock ideas are a rule-based screen
   shown with their real track record — no price targets, position sizes or certainty.
4. **Privacy.** Nothing personal in git: no real names, no email addresses (except GitHub noreply
   and `example.com`-style placeholders), no webhook URLs or keys. Secrets live in `.env.local`
   only. Commit with your GitHub noreply address
   (`git config user.email <id>+<handle>@users.noreply.github.com`).
5. **Battery and resources.** Scheduled work runs as run-once jobs that unload the AI model and
   exit. Nothing heavy loads unless it's used; background updates slow down on battery and pause
   when the window is unfocused.
6. **Tests.** Every connector, parser, tool and script's pure logic gets vitest tests with small
   inline fixtures (no network in tests). Verify UI changes in a browser.
7. **Small local model.** Where correctness matters, compute it in code and let the model only
   phrase it (see `src/lib/analyst/ideas-answer.ts`).

## How to add things

- **A data source:** create `src/data-sources/<id>/` implementing `DataSourceConnector`
  (`fetch(ctx)` + pure `parse(raw, ctx)` → `EventCandidate[]`), register it in
  `src/data-sources/registry.ts`, add a row to `docs/DATA_SOURCES.md` (licence/terms included) and
  tests. Let the analyst reach it via a route in `src/lib/analyst/router.ts` and the `source`
  description in `src/lib/analyst/tools.ts`.
- **An analyst tool:** add a `ToolDef` in `src/lib/analyst/tools.ts`, a dependency in `ToolDeps`
  (real implementation in `deps.ts`, mock in `tests/analyst.test.ts`) and routing in `router.ts`.
- **A page:** add the id to `APP_VIEWS` in `src/lib/store/ui.ts`, an entry in
  `src/components/layout/NavRail.tsx`, and render it in `Dashboard.tsx`.
- **A map overlay:** live layers live in `src/layers/` (provider + `/api/layers/[id]`); toggles go
  in `PlotPanel.tsx`.

More detail: [HANDOFF.md section 6](HANDOFF.md#6-how-to-extend-it).

## Commits and pull requests

- Small, focused commits. The subject line says what changed in plain words
  (e.g. `Sources: add INGV earthquakes`, `Fix drop-in marker clicks at high pitch`); list
  related changes after a colon or in the body.
- One topic per PR; describe what you verified (checks, browser).
- Keep docs in step: source counts, `docs/DATA_SOURCES.md`, README tables.
- By contributing you agree your work is licensed under the [Apache License 2.0](LICENSE).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
