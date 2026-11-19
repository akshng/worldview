# Setting up WorldView

WorldView runs on your own computer. It needs no account, no API keys and no cloud service: every
data source is free and public, and the AI runs on your machine. These steps work on macOS, Windows
and Linux.

## What you need

| | |
|---|---|
| **Node.js 22 or newer** | [nodejs.org](https://nodejs.org) (the LTS installer is fine). Check with `node -v`. |
| **git** | [git-scm.com](https://git-scm.com), or install the Xcode Command Line Tools on a Mac (`xcode-select --install`). |
| **Disk space** | About 1 GB for the app, plus 3.1 GB if you want the local AI. Allow about 5 GB in all. |
| **Memory** | 8 GB of RAM is enough. The AI uses about 3 GB while it's answering and unloads itself after 2 idle minutes. |

## 1. Install and run (5 minutes)

```bash
git clone https://github.com/akshng/worldview.git
```

```bash
cd worldview
```

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000**. The first minute or two shows little data while the sources run
for the first time. After that the store fills up and keeps itself current.

## 2. Settings (optional)

Everything works without settings. To change any, copy the example file and edit the copy:

```bash
cp .env.example .env.local
```

On Windows PowerShell, run `Copy-Item .env.example .env.local` instead.

`.env.local` is git-ignored, so it never gets uploaded. **Don't commit it, and don't paste it
anywhere.** These are the settings most people want:

| Setting | What it does |
|---|---|
| `WORLDVIEW_CONTACT` | Your email address. Some government sources (the SEC and the US weather service) ask apps to identify themselves; your email goes into the request header for those sources only. Without it, the SEC-filing features (10-K text, insider buys, 13F, 13D) are skipped. |
| `DISCORD_WEBHOOK_URL` | Posts a morning briefing, major-event alerts, a market-close wrap and stock setups to a Discord channel. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL. **Treat it like a password**, because anyone with it can post to your channel. Test it with `npm run discord:test`. |
| `AI_PROVIDER` | `local` (default, on-device and free), `anthropic` (hosted Claude; needs `AI_API_KEY`), or `none` to turn the AI off. |
| `WORLDVIEW_DATA_MODE` | `live` (real data, the default) or `demo` (clearly labelled simulated data, which works offline). |

`.env.example` documents every other setting. Restart the app after changing any of them.

## 3. The local AI (optional)

The analyst, the briefing summary and the event explanations use **Gemma 4 E2B** (Apache-2.0),
which runs on your own computer. It downloads by itself the first time you use an AI feature. To
download it ahead of time (3.1 GB, saved to `.data/models/`), run:

```bash
npm run ai:setup
```

Speed depends on your hardware:
- **Apple Silicon Macs:** fast.
- **Windows or Linux with an NVIDIA (CUDA) or Vulkan GPU:** fast.
- **CPU only:** works, but slower.

AI text is always labelled as AI. The facts on screen come straight from the sources.

## 4. Keep it running (optional)

`npm run dev` is for trying the app or changing its code. For everyday use, build it once and run
the faster production server:

```bash
npm run build
```

```bash
npm start
```

**macOS: always-on, battery-friendly**

| Command | What it sets up |
|---|---|
| `npm run service:install` | Starts WorldView at login in the background. `npm run service:uninstall` removes it. |
| `npm run power:install` | Battery mode. On battery the server stops when nobody is looking at it, and a small check every 15 minutes wakes the AI only when something important happens. |
| `npm run briefing:schedule` | Writes the morning briefing at 07:30, then shuts down. |
| `npm run close:schedule` | Posts the after-close market wrap. |
| `npm run mac:build` | Builds the native Mac app with a menu-bar ticker. It's saved into `mac/build/`. |

**Windows**
- `npm run windows:schedule` adds the morning briefing and after-close jobs to Task Scheduler for
  your user, without needing admin rights. `npm run windows:unschedule` removes them.
- To keep the server running all the time, use a process manager such as `pm2`.
- You can also install the page as an app from Chrome or Edge (⋮ menu → Install).

**Linux**
- Run `npm start` under systemd or `pm2`.
- Schedule `npm run briefing:morning` and `npm run close:run` with cron.

## 5. Updating

```bash
git pull
```

```bash
npm install
```

```bash
npm run build
```

Then restart the app, or run `npm run service:restart` on a Mac. Your data in `.data/` is kept.

## Privacy and safety

- **Nothing to sign up for.** Nothing is sent anywhere except plain requests to the public data
  sources, which identify themselves honestly as WorldView.
- **Local only.** The server only accepts connections from your own computer (`127.0.0.1`).
  Other devices on your network can't reach it.
- **Your data stays on your computer.** The event store, watchlist, alert rules, logs and the AI
  model all live in `.data/`, which is git-ignored.
- **Not financial advice.** Stock setups and analyst answers are screens and summaries to research
  further.

## Troubleshooting

| Problem | Fix |
|---|---|
| `localhost:3000` won't load | Try **http://127.0.0.1:3000**. If port 3000 is already used by something else, stop that program or run `npx next dev -H 127.0.0.1 -p 3001`. |
| The map or feed is empty | Wait a couple of minutes on first start. Settings → Data sources shows each source's status, and **http://localhost:3000/api/health** reports problems. |
| `npm install` fails while building `node-llama-cpp` | Update Node to 22+ and try again. On Windows, install the "Desktop development with C++" workload from Visual Studio Build Tools. The rest of the app works even if the AI can't install; set `AI_PROVIDER=none`. |
| The AI is slow | That's normal on CPU-only machines. Shorter questions help, or set `AI_PROVIDER=none`. |
| "Could not find a production build" | Run `npm run build` before `npm start`. |
| You want to start fresh | Stop the app and delete the `.data/` folder (this also deletes the downloaded AI model). |

## Uninstall

**On a Mac, remove the background jobs first:**

```bash
npm run service:uninstall
```

```bash
npm run power:uninstall
```

```bash
npm run briefing:unschedule
```

```bash
npm run close:unschedule
```

**On Windows, remove the scheduled jobs:**

```bash
npm run windows:unschedule
```

Then delete the `worldview` folder. Nothing is installed anywhere else.

---

More detail: [README.md](README.md) (features, sources, API), [HANDOFF.md](HANDOFF.md) (code map
and project rules), [docs/](docs/) (architecture and data sources). Questions or bugs: open an issue.
Security problems: see [SECURITY.md](SECURITY.md).
