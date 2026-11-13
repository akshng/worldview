import { describe, expect, it } from "vitest";
import {
  TASKS,
  buildTaskXml,
  closeSlots,
  cmdArguments,
  createArgs,
  deleteArgs,
  nyOffsetMinutes,
  parseArgs,
  parseTime,
  utf16le,
  xmlEscape,
} from "../scripts/schedule-windows.mjs";

const PROJECT = "C:\\Users\\student\\Code\\world view (x86) & co";
const NPM = "C:\\Program Files\\nodejs\\npm.cmd";

describe("schedule-windows: time and arguments", () => {
  it("parses 24 h times and rejects bad ones", () => {
    expect(parseTime("7:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseTime("06:05")).toEqual({ hour: 6, minute: 5 });
    expect(parseTime("23:59")).toEqual({ hour: 23, minute: 59 });
    for (const bad of ["24:00", "7:60", "7", "7:5", "07:30 & calc", "", undefined]) expect(parseTime(bad)).toBeNull();
  });

  it("parses the command line", () => {
    expect(parseArgs([])).toMatchObject({ command: "install", time: { hour: 7, minute: 30 }, sentinel: false, error: null });
    expect(parseArgs(["6:45", "--sentinel"])).toMatchObject({ command: "install", time: { hour: 6, minute: 45 }, sentinel: true });
    expect(parseArgs(["remove"]).command).toBe("remove");
    expect(parseArgs(["--remove"]).command).toBe("remove");
    expect(parseArgs(["status"]).command).toBe("status");
    expect(parseArgs(["25:00"]).error).toMatch(/Invalid time/);
    expect(parseArgs(["--evil"]).error).toMatch(/Unknown argument/);
  });

  it("builds schtasks argument arrays (no shell)", () => {
    expect(createArgs(TASKS.morning.name, "C:\\Temp\\m.xml")).toEqual(["/Create", "/F", "/TN", "WorldView Morning Briefing", "/XML", "C:\\Temp\\m.xml"]);
    expect(deleteArgs(TASKS.close.name)).toEqual(["/Delete", "/F", "/TN", "WorldView Market Close"]);
  });

  it("quotes the cmd.exe line and refuses characters cmd would interpret", () => {
    expect(cmdArguments(NPM, "briefing:morning", ".data\\morning.log")).toBe(
      '/d /s /c ""C:\\Program Files\\nodejs\\npm.cmd" run briefing:morning >> ".data\\morning.log" 2>&1"',
    );
    expect(() => cmdArguments('C:\\a"b\\npm.cmd', "sentinel", ".data\\s.log")).toThrow(/Unsupported/);
    expect(() => cmdArguments("C:\\%PATH%\\npm.cmd", "sentinel", ".data\\s.log")).toThrow(/Unsupported/);
    expect(() => cmdArguments(NPM, "sentinel & calc", ".data\\s.log")).toThrow();
  });

  it("escapes XML", () => {
    expect(xmlEscape(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });
});

describe("schedule-windows: close-job slots", () => {
  it("uses 13:00–18:00 weekdays for US time zones", () => {
    for (const offset of [0, -60, -120, -180]) {
      const slots = closeSlots(offset);
      expect(slots.map((s) => s.hour)).toEqual([13, 14, 15, 16, 17, 18]);
      expect(slots[0].days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    }
  });

  it("moves to the local time of the US close elsewhere", () => {
    // London (+5 h): close is 21:45 local
    expect(closeSlots(300).map((s) => s.hour)).toEqual([22, 23, 0]);
    expect(closeSlots(300)[0].days[0]).toBe("Monday");
    expect(closeSlots(300)[2].days).toEqual(["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    // Tokyo (+14 h): 06:45 the next morning
    const tokyo = closeSlots(14 * 60);
    expect(tokyo.map((s) => s.hour)).toEqual([7, 8, 9]);
    expect(tokyo[0].days).toEqual(["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    // Hawaii (-6 h): 10:45 the same day
    expect(closeSlots(-360).map((s) => s.hour)).toEqual([11, 12, 13]);
  });

  it("computes the offset from New York", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(nyOffsetMinutes(winter, "America/New_York")).toBe(0);
    expect(nyOffsetMinutes(winter, "America/Los_Angeles")).toBe(-180);
    expect(nyOffsetMinutes(winter, "Europe/London")).toBe(300);
    expect(nyOffsetMinutes(winter, "Asia/Tokyo")).toBe(14 * 60);
    expect(nyOffsetMinutes(winter, "Asia/Kolkata")).toBe(10 * 60 + 30);
  });
});

describe("schedule-windows: task XML", () => {
  const base = { project: PROJECT, npmCommand: NPM, startDate: "2026-11-12" };

  it("morning task: daily trigger, runs on battery, catches up, escaped paths", () => {
    const xml = buildTaskXml({ ...base, kind: "morning", time: { hour: 7, minute: 5 } });
    expect(xml).toContain("<StartBoundary>2026-11-12T07:05:00</StartBoundary>");
    expect(xml).toContain("<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<WorkingDirectory>C:\\Users\\student\\Code\\world view (x86) &amp; co</WorkingDirectory>");
    expect(xml).toContain(
      "<Arguments>/d /s /c &quot;&quot;C:\\Program Files\\nodejs\\npm.cmd&quot; run briefing:morning &gt;&gt; &quot;.data\\morning.log&quot; 2&gt;&amp;1&quot;</Arguments>",
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });

  it("close task: one weekly trigger per slot", () => {
    const xml = buildTaskXml({ ...base, kind: "close", slots: closeSlots(0) });
    expect(xml.match(/<CalendarTrigger>/g)).toHaveLength(6);
    expect(xml).toContain("<StartBoundary>2026-11-12T13:00:00</StartBoundary>");
    expect(xml).toContain("<StartBoundary>2026-11-12T18:00:00</StartBoundary>");
    expect(xml).toContain("<DaysOfWeek><Monday /><Tuesday /><Wednesday /><Thursday /><Friday /></DaysOfWeek>");
    expect(xml).toContain("run close:run &gt;&gt; &quot;.data\\market-close.log&quot;");
  });

  it("sentinel task: every 15 minutes, no catch-up, short time limit", () => {
    const xml = buildTaskXml({ ...base, kind: "sentinel" });
    expect(xml).toContain("<Interval>PT15M</Interval>");
    expect(xml).toContain("<StartWhenAvailable>false</StartWhenAvailable>");
    expect(xml).toContain("<ExecutionTimeLimit>PT10M</ExecutionTimeLimit>");
    expect(xml).toContain("run sentinel &gt;&gt; &quot;.data\\sentinel.log&quot;");
  });

  it("rejects unsafe or invalid input", () => {
    expect(() => buildTaskXml({ ...base, kind: "morning", time: { hour: 25, minute: 0 } })).toThrow();
    expect(() => buildTaskXml({ ...base, kind: "morning", project: "relative\\dir", time: { hour: 7, minute: 30 } })).toThrow(/project path/);
    expect(() => buildTaskXml({ ...base, kind: "morning", project: "C:\\a%USERNAME%", time: { hour: 7, minute: 30 } })).toThrow(/project path/);
    expect(() => buildTaskXml({ ...base, kind: "close", slots: [{ hour: 13, days: ["Funday"] }] })).toThrow();
    expect(() => buildTaskXml({ ...base, kind: "nope" as "morning" })).toThrow(/Unknown task/);
  });

  it("encodes UTF-16LE with a BOM", () => {
    const buf = utf16le("<a/>");
    expect([...buf.subarray(0, 4)]).toEqual([0xff, 0xfe, 0x3c, 0x00]);
    expect(buf.length).toBe(2 + 8);
  });
});
