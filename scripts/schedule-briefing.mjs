/**
 * Install / remove the daily morning-briefing job (macOS LaunchAgent).
 *
 *   npm run briefing:schedule              # every day at 07:30
 *   npm run briefing:schedule -- 6:45      # custom time (24h, local)
 *   npm run briefing:unschedule
 *
 *   npm run close:schedule                 # after-close job: hourly slots around 16:30 New York
 *
 * launchd runs the job at that time; if the Mac is asleep it runs on wake. The job runs
 * under `caffeinate -i`, so the Mac can't idle-sleep mid-run (e.g. while the AI writes),
 * and exits (unloading the AI model) when it finishes. Logs go to
 * .data/briefings/morning.log / market-close.log (rotated at 5 MB by the server).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const close = process.argv.includes("--close");
const LABEL = close ? "com.worldview.market-close" : "com.worldview.morning-briefing";
const SCRIPT = close ? "scripts/market-close.ts" : "scripts/morning-briefing.ts";
const LOG = close ? "market-close.log" : "morning.log";
const WHAT = close ? "After-close job" : "Morning briefing";
const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const project = path.resolve(import.meta.dirname, "..");
const uid = process.getuid();
const remove = process.argv.includes("--remove");

if (process.platform !== "darwin") {
  console.error("This scheduler uses macOS launchd. On Linux add a cron entry instead, e.g.:\n  30 7 * * * cd " + project + " && npm run briefing:morning");
  process.exit(1);
}

function bootout() {
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* not loaded */
  }
}

if (remove) {
  bootout();
  if (existsSync(plist)) rmSync(plist);
  console.log(`${WHAT} schedule removed.`);
  process.exit(0);
}

/**
 * After-close slots. A single local time frozen at install drifts by an hour whenever
 * New York and this machine change daylight-saving time on different dates (or you
 * travel), and weekday numbers shift for timezones where 16:45 New York is past local
 * midnight. Instead the job runs every day at :35 past each hour from one hour before to
 * three hours after "16:30 New York" in local time (5 runs). The close jobs themselves
 * (src/lib/notify/discord-server.ts, watch.ts) only act on New York weekdays after 16:20 and
 * record what they did per New York date, so the early or repeated runs exit in seconds
 * having done nothing, and a ±1 h DST shift still leaves at least three slots after the
 * close. caffeinate keeps the Mac awake until the run finishes.
 */
function closeSlotsLocal() {
  const now = new Date();
  const parts = (tz) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, Number(p.value) % 24]));
  const ny = parts("America/New_York");
  const here = parts(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const offset = here.hour * 60 + here.minute - (ny.hour * 60 + ny.minute);
  const base = Math.floor(((((16 * 60 + 30 + offset) % 1440) + 1440) % 1440) / 60);
  return [-1, 0, 1, 2, 3].map((d) => (((base + d) % 24) + 24) % 24);
}
const arg = process.argv.slice(2).find((a) => /^\d{1,2}:\d{2}$/.test(a)) ?? (close ? null : "7:30");
const [hour, minute] = arg ? arg.split(":").map(Number) : [null, null];
if (arg && (hour > 23 || minute > 59)) {
  console.error(`Invalid time "${arg}" — use HH:MM (24h).`);
  process.exit(1);
}
const closeHours = close && !arg ? closeSlotsLocal() : null;

const logDir = path.join(project, ".data", "briefings");
mkdirSync(logDir, { recursive: true });
mkdirSync(path.dirname(plist), { recursive: true });
const tsxCli = path.join(project, "node_modules", "tsx", "dist", "cli.mjs");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>${esc(process.execPath)}</string>
    <string>${esc(tsxCli)}</string>
    <string>${SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(project)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_OPTIONS</key><string>--conditions=react-server</string>
    <key>PATH</key><string>${esc(path.dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  ${
    closeHours
      ? `<array>${closeHours.map((h) => `<dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>35</integer></dict>`).join("")}</array>`
      : close
      ? `<array>${[1, 2, 3, 4, 5].map((d) => `<dict><key>Weekday</key><integer>${d}</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`).join("")}</array>`
      : `<dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>`
  }
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(path.join(logDir, LOG))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(logDir, LOG))}</string>
</dict>
</plist>
`,
);

bootout();
execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plist]);
const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
if (closeHours) console.log(`${WHAT} scheduled daily at ${closeHours.map((h) => hhmm(h, 35)).join(", ")} (local time); it acts once per New York weekday after 16:20 New York.`);
else console.log(`${WHAT} scheduled ${close ? "weekdays" : "daily"} at ${hhmm(hour, minute)} (local time).`);
console.log(`  job:  ${plist}`);
console.log(`  log:  ${path.join(logDir, LOG)}`);
console.log(`Run it now with: launchctl kickstart gui/${uid}/${LABEL}`);
