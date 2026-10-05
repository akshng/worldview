/**
 * Install / remove the daily morning-briefing job (macOS LaunchAgent).
 *
 *   npm run briefing:schedule              # every day at 07:30
 *   npm run briefing:schedule -- 6:45      # custom time (24h, local)
 *   npm run briefing:unschedule
 *
 * launchd runs the job at that time; if the Mac is asleep it runs on wake.
 * The job exits (and unloads the AI model) when it finishes. Logs go to
 * .data/briefings/morning.log.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LABEL = "com.worldview.morning-briefing";
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
  console.log("Morning briefing schedule removed.");
  process.exit(0);
}

const arg = process.argv.slice(2).find((a) => /^\d{1,2}:\d{2}$/.test(a)) ?? "7:30";
const [hour, minute] = arg.split(":").map(Number);
if (hour > 23 || minute > 59) {
  console.error(`Invalid time "${arg}" — use HH:MM (24h).`);
  process.exit(1);
}

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
    <string>${esc(process.execPath)}</string>
    <string>${esc(tsxCli)}</string>
    <string>scripts/morning-briefing.ts</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(project)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_OPTIONS</key><string>--conditions=react-server</string>
    <key>PATH</key><string>${esc(path.dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(path.join(logDir, "morning.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(logDir, "morning.log"))}</string>
</dict>
</plist>
`,
);

bootout();
execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plist]);
console.log(`Morning briefing scheduled daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}.`);
console.log(`  job:  ${plist}`);
console.log(`  log:  ${path.join(logDir, "morning.log")}`);
console.log(`Run it now with: launchctl kickstart gui/${uid}/${LABEL}`);
