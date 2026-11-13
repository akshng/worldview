/**
 * Run the production build as an always-on local service (macOS LaunchAgent).
 *
 *   npm run build && npm run service:install    # http://localhost:3000, starts at login, restarts on crash
 *   npm run service:uninstall
 *
 * Re-run `npm run build` then `npm run service:restart` after pulling changes.
 * Logs: .data/server.log — lines are timestamped, and the server rotates it (and the job
 * logs) at 5 MB keeping two old copies, at start and hourly (src/lib/server/logs.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LABEL = "com.worldview.server";
const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const project = path.resolve(import.meta.dirname, "..");
const target = `gui/${process.getuid()}`;
const cmd = process.argv[2] ?? "install";
const port = process.env.PORT || "3000";

if (process.platform !== "darwin") {
  console.error("This uses macOS launchd. Elsewhere run `npm run build && npm start` under your process manager.");
  process.exit(1);
}

const bootout = () => {
  try {
    execFileSync("launchctl", ["bootout", `${target}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* not loaded */
  }
};

if (cmd === "uninstall") {
  bootout();
  if (existsSync(plist)) rmSync(plist);
  console.log("WorldView local service removed.");
  process.exit(0);
}
if (cmd === "restart") {
  execFileSync("launchctl", ["kickstart", "-k", `${target}/${LABEL}`], { stdio: "inherit" });
  console.log(`WorldView restarted — http://localhost:${port}`);
  process.exit(0);
}

if (!existsSync(path.join(project, ".next", "BUILD_ID"))) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const log = path.join(project, ".data", "server.log");
mkdirSync(path.dirname(log), { recursive: true });
mkdirSync(path.dirname(plist), { recursive: true });
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
    <string>${esc(path.join(project, "node_modules", "next", "dist", "bin", "next"))}</string>
    <string>start</string>
    <string>--hostname</string><string>127.0.0.1</string>
    <string>--port</string><string>${port}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(project)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>${esc(path.dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`,
);
bootout();
execFileSync("launchctl", ["bootstrap", target, plist]);
console.log(`WorldView is running at http://localhost:${port} (starts at login, restarts if it crashes).`);
console.log(`  log: ${log}`);
