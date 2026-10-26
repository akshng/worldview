/**
 * Battery-friendly mode (macOS LaunchAgents).
 *
 *   npm run power:install     # power watcher (every 2 min) + battery sentinel (every 15 min)
 *   npm run power:uninstall   # back to always-on
 *   npm run app               # open WorldView now (starts the server even on battery)
 *
 * Plugged in: the server runs as usual. On battery: the server stops when no tab
 * is open, and a small sentinel checks USGS / GDACS / tsunami feeds and big market
 * moves, waking the AI only when something crosses the alert bar.
 * Logs: .data/power.log, .data/sentinel.log
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync, closeSync, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
const target = `gui/${process.getuid()}`;
const agents = path.join(os.homedir(), "Library", "LaunchAgents");
const cmd = process.argv[2] ?? "install";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const data = path.join(project, ".data");
mkdirSync(data, { recursive: true });

const bootout = (label) => {
  try {
    execFileSync("launchctl", ["bootout", `${target}/${label}`], { stdio: "ignore" });
  } catch {
    /* not loaded */
  }
};

function agent(label, args, interval, log, env = {}) {
  const file = path.join(agents, `${label}.plist`);
  const envXml = Object.entries({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, ...env })
    .map(([k, v]) => `    <key>${k}</key><string>${esc(v)}</string>`)
    .join("\n");
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${esc(project)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`,
  );
  bootout(label);
  execFileSync("launchctl", ["bootstrap", target, file]);
}

const LABELS = ["com.worldview.power", "com.worldview.sentinel"];

if (cmd === "uninstall") {
  for (const l of LABELS) {
    bootout(l);
    rmSync(path.join(agents, `${l}.plist`), { force: true });
  }
  const server = path.join(agents, "com.worldview.server.plist");
  if (existsSync(server)) {
    try {
      execFileSync("launchctl", ["bootstrap", target, server], { stdio: "ignore" });
    } catch {
      /* already running */
    }
  }
  console.log("Battery mode off — the WorldView server stays on all the time again.");
  process.exit(0);
}

if (cmd === "app") {
  const seen = path.join(data, "last-viewer");
  closeSync(openSync(seen, "a"));
  utimesSync(seen, new Date(), new Date());
  const server = path.join(agents, "com.worldview.server.plist");
  try {
    execFileSync("launchctl", ["bootstrap", target, server], { stdio: "ignore" });
  } catch {
    /* already running */
  }
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync("curl", ["-sf", "--max-time", "1", "http://127.0.0.1:3000/api/meta"], { stdio: "ignore" });
      break;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  execFileSync("open", ["http://127.0.0.1:3000"]);
  console.log("WorldView is open at http://127.0.0.1:3000");
  process.exit(0);
}

mkdirSync(agents, { recursive: true });
agent("com.worldview.power", ["/bin/sh", path.join(project, "scripts", "power-watch.sh")], 120, path.join(data, "power.log"));
agent(
  "com.worldview.sentinel",
  [process.execPath, path.join(project, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/sentinel.ts"],
  900,
  path.join(data, "sentinel.log"),
  { NODE_OPTIONS: "--conditions=react-server" },
);
console.log("Battery mode on:");
console.log("  plugged in  → WorldView server runs (live data, instant alerts)");
console.log("  on battery  → server stops when no tab is open; sentinel checks every 15 min, AI only wakes on a trigger");
console.log("  open on battery: npm run app");
