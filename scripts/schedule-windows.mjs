/**
 * Install / remove WorldView's run-once jobs in Windows Task Scheduler (current user, no admin).
 *
 *   npm run windows:schedule                       # morning briefing 07:30 + after-close job
 *   npm run windows:schedule -- 06:45              # custom briefing time (24 h, local)
 *   npm run windows:schedule -- --sentinel         # also the battery sentinel every 15 min
 *   npm run windows:unschedule                     # remove all WorldView tasks
 *   node scripts/schedule-windows.mjs status       # show what is installed
 *
 * Tasks (the Windows counterpart of scripts/schedule-briefing.mjs and power-mode.mjs):
 *   WorldView Morning Briefing  daily at the given time        npm run briefing:morning  .data\morning.log
 *   WorldView Market Close      weekdays, hourly 13:00–18:00   npm run close:run         .data\market-close.log
 *   WorldView Sentinel          every 15 minutes (optional)    npm run sentinel          .data\sentinel.log
 *
 * The close job checks New York time itself and does each day's work once, so the extra hourly
 * slots only cost a few seconds. Outside the US the slots move to the local time of the US close.
 * Every job runs once, unloads the AI model and exits. Tasks run on battery and catch up after the
 * PC was asleep or off at the scheduled time (like launchd on the Mac). They run as you, only while
 * you are logged in, so a console window shows briefly while a job runs.
 *
 * Tasks are registered from Task Scheduler XML via `schtasks /Create /XML` (the plain /SC flags
 * cannot allow running on battery). Everything is passed to schtasks as an argument array —
 * never through a shell.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TASKS = {
  morning: { name: "WorldView Morning Briefing", npmScript: "briefing:morning", log: "morning.log", description: "WorldView: prepare the daily morning briefing, then exit." },
  close: { name: "WorldView Market Close", npmScript: "close:run", log: "market-close.log", description: "WorldView: US market-close wrap and stock setups (the job checks New York time and runs once per trading day)." },
  sentinel: { name: "WorldView Sentinel", npmScript: "sentinel", log: "sentinel.log", description: "WorldView: cheap check for major events every 15 minutes while the server is off." },
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const ALL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The close job's default local slots (covers every US mainland time zone). */
export const DEFAULT_CLOSE_HOURS = [13, 14, 15, 16, 17, 18];
const NY_CLOSE_MINUTES = 16 * 60 + 45;

/** "7:30" / "07:30" → { hour, minute }; null if it isn't a valid 24 h time. */
export function parseTime(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? "").trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

const pad = (n) => String(n).padStart(2, "0");

/** Minutes that the local clock is ahead of New York's at `now` (negative = behind). */
export function nyOffsetMinutes(now = new Date(), localTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const wall = (tz) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(now)
        .map((x) => [x.type, Number(x.value)]),
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  };
  return Math.round((wall(localTz) - wall("America/New_York")) / 60_000);
}

/**
 * Local trigger slots for the close job: [{ hour, days }]. When the US close (16:45 New York) falls
 * between 13:00 and 18:00 local, the default 13:00–18:00 weekday slots; otherwise three hourly slots
 * from the first full hour after the local close, with the weekdays shifted when that is on another
 * local day (e.g. Tuesday–Saturday mornings in Asia).
 */
export function closeSlots(offsetMinutes) {
  const close = NY_CLOSE_MINUTES + offsetMinutes; // local minutes from New York's midnight
  if (close >= 13 * 60 && close <= 18 * 60) return DEFAULT_CLOSE_HOURS.map((hour) => ({ hour, days: WEEKDAYS }));
  const first = Math.ceil(close / 60);
  return [first, first + 1, first + 2].map((h) => {
    const shift = Math.floor(h / 24);
    const days = WEEKDAYS.map((d) => ALL_DAYS[(((ALL_DAYS.indexOf(d) + shift) % 7) + 7) % 7]);
    return { hour: ((h % 24) + 24) % 24, days };
  });
}

/** Characters that could change the meaning of the cmd.exe command line (or are invalid in paths). */
const UNSAFE = /["%\r\n\0^!]/;

/** Arguments for `cmd.exe`: run one npm script in the project folder, appending to a log. */
export function cmdArguments(npmCommand, npmScript, logFile) {
  for (const [what, v] of [["npm path", npmCommand], ["npm script", npmScript], ["log file", logFile]]) {
    if (UNSAFE.test(v)) throw new Error(`Unsupported character in ${what}: ${v}`);
  }
  if (!/^[a-z][a-z:-]*$/i.test(npmScript)) throw new Error(`Unexpected npm script name: ${npmScript}`);
  // /d skips AutoRun, /s + outer quotes: cmd strips exactly the first and last quote.
  return `/d /s /c ""${npmCommand}" run ${npmScript} >> "${logFile}" 2>&1"`;
}

export function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function calendarTrigger(start, hour, minute, days) {
  const boundary = `${start}T${pad(hour)}:${pad(minute)}:00`;
  const schedule = days
    ? `<ScheduleByWeek><DaysOfWeek>${days.map((d) => `<${d} />`).join("")}</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>`
    : `<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>`;
  return `    <CalendarTrigger>
      <StartBoundary>${boundary}</StartBoundary>
      <Enabled>true</Enabled>
      ${schedule}
    </CalendarTrigger>`;
}

/**
 * Task Scheduler XML for one job.
 * @param {{ kind: "morning" | "close" | "sentinel", project: string, npmCommand: string, startDate: string,
 *           time?: { hour: number, minute: number }, slots?: { hour: number, days: string[] }[] }} o
 */
export function buildTaskXml(o) {
  const task = TASKS[o.kind];
  if (!task) throw new Error(`Unknown task: ${o.kind}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.startDate)) throw new Error(`Bad start date: ${o.startDate}`);
  if (!path.win32.isAbsolute(o.project) || UNSAFE.test(o.project)) throw new Error(`Unsupported project path: ${o.project}`);
  let triggers;
  if (o.kind === "morning") {
    if (!o.time || !parseTime(`${o.time.hour}:${pad(o.time.minute)}`)) throw new Error("A valid time is required");
    triggers = calendarTrigger(o.startDate, o.time.hour, o.time.minute, null);
  } else if (o.kind === "close") {
    const slots = o.slots ?? DEFAULT_CLOSE_HOURS.map((hour) => ({ hour, days: WEEKDAYS }));
    for (const s of slots) {
      if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23 || !s.days.every((d) => ALL_DAYS.includes(d))) throw new Error("Bad close slot");
    }
    triggers = slots.map((s) => calendarTrigger(o.startDate, s.hour, 0, s.days)).join("\n");
  } else {
    triggers = `    <TimeTrigger>
      <Repetition><Interval>PT15M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>${o.startDate}T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>`;
  }
  const args = cmdArguments(o.npmCommand, task.npmScript, `.data\\${task.log}`);
  const catchUp = o.kind !== "sentinel"; // a missed sentinel check is simply skipped
  const limit = o.kind === "sentinel" ? "PT10M" : "PT1H";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(task.description)}</Description>
  </RegistrationInfo>
  <Triggers>
${triggers}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>${catchUp}</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>${limit}</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(o.project)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** schtasks expects UTF-16 for an XML that declares it: little-endian with a BOM. */
export function utf16le(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

export const createArgs = (name, xmlFile) => ["/Create", "/F", "/TN", name, "/XML", xmlFile];
export const deleteArgs = (name) => ["/Delete", "/F", "/TN", name];
export const queryArgs = (name) => ["/Query", "/TN", name, "/FO", "LIST"];

/** argv (after the script path) → { command, time, sentinel, error } */
export function parseArgs(argv) {
  const out = { command: "install", time: { hour: 7, minute: 30 }, sentinel: false, error: null };
  for (const a of argv) {
    if (a === "install" || a === "remove" || a === "status") out.command = a;
    else if (a === "--remove" || a === "uninstall") out.command = "remove";
    else if (a === "--sentinel") out.sentinel = true;
    else if (/^\d{1,2}:\d{2}$/.test(a)) {
      const t = parseTime(a);
      if (!t) out.error = `Invalid time "${a}" — use HH:MM (24 h, local).`;
      else out.time = t;
    } else out.error = `Unknown argument "${a}". Usage: install [HH:MM] [--sentinel] | remove | status`;
  }
  return out;
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(opts.error);
    process.exit(1);
  }
  if (process.platform !== "win32") {
    console.error(
      "This scheduler uses Windows Task Scheduler and only runs on Windows.\n" +
        "  macOS: npm run briefing:schedule, npm run close:schedule, npm run power:install\n" +
        "  Linux: add cron lines, e.g.  30 7 * * * cd /path/to/worldview && npm run briefing:morning",
    );
    process.exit(1);
  }
  const project = path.resolve(import.meta.dirname, "..");
  const schtasks = (args, quiet = false) => execFileSync("schtasks", args, { stdio: quiet ? "ignore" : ["ignore", "inherit", "inherit"], windowsHide: true });

  if (opts.command === "remove") {
    for (const t of Object.values(TASKS)) {
      try {
        schtasks(deleteArgs(t.name), true);
        console.log(`Removed "${t.name}".`);
      } catch {
        /* not installed */
      }
    }
    console.log("WorldView scheduled tasks removed.");
    return;
  }
  if (opts.command === "status") {
    for (const t of Object.values(TASKS)) {
      try {
        schtasks(queryArgs(t.name));
      } catch {
        console.log(`"${t.name}": not installed`);
      }
    }
    return;
  }

  // npm.cmd ships next to node.exe; fall back to whatever is on PATH (nvm-windows, volta…).
  const besideNode = path.join(path.dirname(process.execPath), "npm.cmd");
  const npmCommand = existsSync(besideNode) ? besideNode : "npm.cmd";
  mkdirSync(path.join(project, ".data"), { recursive: true });
  const startDate = localDate();
  const slots = closeSlots(nyOffsetMinutes());
  const kinds = ["morning", "close", ...(opts.sentinel ? ["sentinel"] : [])];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "worldview-tasks-"));
  try {
    for (const kind of kinds) {
      const xml = buildTaskXml({ kind, project, npmCommand, startDate, time: opts.time, slots });
      const file = path.join(tmp, `${kind}.xml`);
      writeFileSync(file, utf16le(xml));
      schtasks(createArgs(TASKS[kind].name, file));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const hhmm = (h, m = 0) => `${pad(h)}:${pad(m)}`;
  console.log(`\nMorning briefing: daily at ${hhmm(opts.time.hour, opts.time.minute)} (local)  → .data\\${TASKS.morning.log}`);
  console.log(`After-close job:  ${slots[0].days[0].slice(0, 3)}–${slots[0].days.at(-1).slice(0, 3)} at ${slots.map((s) => hhmm(s.hour)).join(", ")} (local; runs once per US trading day)  → .data\\${TASKS.close.log}`);
  if (opts.sentinel) console.log(`Sentinel:         every 15 min  → .data\\${TASKS.sentinel.log}`);
  console.log(`Run one now:  schtasks /Run /TN "${TASKS.morning.name}"`);
  console.log("Remove:       npm run windows:unschedule");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
