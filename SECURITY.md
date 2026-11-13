# Security policy

## What WorldView is

WorldView is a **local, single-user app**: you run it on your own computer, it has no login and no
accounts, and it reads free, public, keyless data feeds. There is no hosted WorldView service. The
only things that leave your machine are the app's own requests to public data sources, and — only if
you configure them — posts to your Discord webhook and questions to Anthropic's API.

## Security model

- **Loopback only.** `npm run dev` and `npm start` bind to `127.0.0.1`, so other devices on the
  network can't reach the server.
- **API request guard.** `src/proxy.ts` checks every `/api` request:
  - the `Host` header must be a loopback name (`127.0.0.1`, `localhost`, `[::1]`), which blocks DNS
    rebinding;
  - browser requests labelled `Sec-Fetch-Site: cross-site` or `same-site` are refused, and so are
    foreign or opaque (`null`) `Origin`s. This stops other websites you visit from posting to your
    Discord, starting AI jobs or changing your watchlist (CSRF / drive-by requests). The app itself
    sends `same-origin`; scripts and `curl` send no Fetch Metadata and are allowed.
- **Admin actions.** `isAdminRequest` (`src/lib/server/http.ts`) protects manual ingestion, AI
  unload and similar endpoints with the same rules, or with `Authorization: Bearer <ADMIN_TOKEN>`
  when `ADMIN_TOKEN` is set.
- **Secrets stay local.** Keys, tokens and the Discord webhook URL live only in `.env.local`
  (git-ignored). They are read on the server (`src/lib/env.ts`, guarded by `server-only`) and never
  sent to the browser. Nothing secret or personal is committed; CI runs gitleaks over the full
  history and a personal-information check on every push.
- **Dependencies.** `npm audit --omit=dev --audit-level=high` runs in CI and weekly; Dependabot
  proposes updates. `next/image` is disabled (unused).

If you expose WorldView beyond your own machine (a reverse proxy, a tunnel, `-H 0.0.0.0`), you are
outside this model: there is no authentication, so put your own access control in front of it.

## Supported versions

WorldView has no release branches yet. Security fixes go to the latest commit on `main`; please
update to it (`git pull && npm install && npm run build`) before reporting.

| Version | Supported |
| --- | --- |
| `main` (latest) | Yes |
| Older commits | No |

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report privately through GitHub:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub private vulnerability reporting), or open
   `https://github.com/akshng/worldview/security/advisories/new`.
2. Describe the issue, the affected file or endpoint, how to reproduce it and the impact you see.

You should get an acknowledgement within a week. Fixes are developed in a private security
advisory, and you'll be credited in it unless you'd rather not be.

## Scope

In scope:

- Ways for a website, another local user or another device to reach or misuse the local API
  (bypassing `src/proxy.ts` or `isAdminRequest`).
- Leaks of `.env.local` values (keys, webhook URL) to the browser, logs, Discord posts or git.
- Injection through data from upstream feeds (XSS in event text, unsafe URLs, command injection in
  scripts such as the schedulers).
- Secrets or personal information committed to the repository.

Out of scope:

- Problems that require an attacker who already controls your user account or machine.
- Running WorldView exposed to a network without your own authentication (see above).
- Accuracy or availability of third-party data sources, and rate limiting by those sources.
- Vulnerabilities in dependencies with no practical impact on WorldView (report those upstream;
  Dependabot will pick up the fix).

## Safe harbor

Good-faith security research on **your own copy** of WorldView is welcome. Don't test against
other people's machines, don't attack the public data sources the app uses, and don't access or
keep data that isn't yours. If you follow this policy, we won't pursue or support legal action
against you for your research, and we'll work with you to understand and fix the issue.
