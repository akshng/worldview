/**
 * Japan Meteorological Agency volcanic warnings (keyless JSON behind jma.go.jp/bosai).
 * warning.json holds the warning currently in force for each volcano with its issue
 * time; volcano_list.json gives the summit coordinates and English names. Level 1 /
 * "be aware it is an active volcano" (normal) and lifted warnings are skipped.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface JmaVolcanoWarning {
  reportDatetime?: string;
  eventId?: string;
  volcanoInfos?: { type?: string; items?: { name?: string; code?: string; condition?: string; areas?: { name?: string; code?: string }[] }[] }[];
}
export interface JmaVolcanoInfo {
  code: string;
  latlon?: [string, string];
  name_jp?: string;
  name_en?: string;
}
export interface JmaVolcanoRaw {
  warnings: JmaVolcanoWarning[];
  volcanoes: JmaVolcanoInfo[];
}

export async function fetchJmaVolcano(ctx: FetchContext): Promise<JmaVolcanoRaw> {
  const [w, v] = await Promise.all([
    httpGet("https://www.jma.go.jp/bosai/volcano/data/warning.json", ctx).then((r) => r.json()),
    httpGet("https://www.jma.go.jp/bosai/volcano/const/volcano_list.json", ctx).then((r) => r.json()),
  ]);
  return { warnings: w as JmaVolcanoWarning[], volcanoes: v as JmaVolcanoInfo[] };
}

const FW = "０１２３４５６７８９";
const CONDITIONS: Record<string, string> = { 発表: "issued", 継続: "continued", 引上げ: "raised", 引下げ: "lowered", 切替: "switched", 解除: "lifted" };
const LEVEL_TEXT: Record<number, string> = {
  2: "do not approach the crater",
  3: "do not approach the volcano",
  4: "prepare to evacuate",
  5: "evacuate",
};

/** Japanese warning name → level and English description; null for normal (level 1) states. */
export function describeJmaVolcanoWarning(name: string): { level: number | null; label: string; eruption: boolean } | null {
  const n = name.replace(/[０-９]/g, (c) => String(FW.indexOf(c)));
  const lvl = /レベル(\d)/.exec(n);
  if (lvl) {
    const level = Number(lvl[1]);
    if (level <= 1) return null;
    return { level, label: `level ${level} (${LEVEL_TEXT[level] ?? "elevated"})`, eruption: level >= 4 };
  }
  if (n.includes("留意")) return null;
  if (n.includes("居住地域")) return { level: null, label: "eruption warning for residential areas", eruption: true };
  if (n.includes("入山")) return { level: null, label: "eruption warning: danger on the mountain", eruption: false };
  if (n.includes("火口周辺")) return { level: null, label: "near-crater warning", eruption: false };
  if (n.includes("周辺海域")) return { level: null, label: "marine warning for the waters around the volcano", eruption: false };
  return { level: null, label: "volcanic warning", eruption: false };
}

export function parseJmaVolcano(raw: JmaVolcanoRaw, ctx: ParseContext): ParseResult {
  const info = new Map((raw.volcanoes ?? []).map((v) => [String(v.code), v]));
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const w of raw.warnings ?? []) {
    const target = w.volcanoInfos?.find((vi) => vi.type?.includes("対象火山"))?.items?.[0];
    const code = target?.areas?.[0]?.code ?? w.eventId;
    const v = code ? info.get(String(code)) : undefined;
    const lat = Number(v?.latlon?.[0]), lon = Number(v?.latlon?.[1]);
    const issued = w.reportDatetime ? new Date(w.reportDatetime) : null;
    const desc = target?.name ? describeJmaVolcanoWarning(target.name) : null;
    if (!target || !code || !v || !Number.isFinite(lat) || !Number.isFinite(lon) || !issued || Number.isNaN(issued.getTime()) || !desc || target.condition === "解除") {
      skipped++;
      continue;
    }
    const name = v.name_en?.trim() || v.name_jp?.trim() || target.areas?.[0]?.name || `volcano ${code}`;
    const condition = target.condition ? (CONDITIONS[target.condition] ?? target.condition) : null;
    const when = issued.toISOString();
    const title = `${name} volcano — JMA ${desc.label}`;
    candidates.push({
      type: "VOLCANO",
      subtype: desc.eruption ? "eruption" : "volcanic-unrest",
      title,
      summary:
        `The Japan Meteorological Agency has ${name} under a ${desc.label}` +
        `${condition ? ` (${condition} in the latest bulletin)` : ""}, in force since ${when.replace("T", " ").slice(0, 16)} UTC.`,
      latitude: lat,
      longitude: lon,
      geoPrecision: "exact",
      locationName: `${name}, Japan`,
      country: "JP",
      timestamp: when,
      metrics: { alert_level: desc.level, warning: desc.label, condition },
      entities: [{ type: "ORGANIZATION", name: "Japan Meteorological Agency", code: "JMA" }],
      source: {
        id: `jma-volcano:${code}`,
        dataSourceId: "jma-volcano",
        externalId: String(code),
        sourceName: "Japan Meteorological Agency (JMA) — volcanic warnings",
        sourceUrl: "https://www.jma.go.jp/bosai/map.html#contents=volcano&lang=en",
        title,
        titleIsDerived: true,
        publishedAt: when,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "Japanese national meteorological agency, responsible for volcanic warnings" },
      },
      rawData: { code, reportDatetime: w.reportDatetime, name: target.name, condition: target.condition },
    });
  }
  return { candidates, skipped };
}

export const jmaVolcanoConnector: DataSourceConnector<JmaVolcanoRaw> = {
  id: "jma-volcano",
  name: "JMA volcanic warnings (Japan)",
  description: "Japanese volcanoes under a JMA volcanic alert level of 2 or above, or a near-crater / marine volcanic warning, with the time the warning in force was issued.",
  homepage: "https://www.jma.go.jp/bosai/map.html#contents=volcano&lang=en",
  attribution: "Japan Meteorological Agency — Public Data License (government standard terms of use), attribution required",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["VOLCANO"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchJmaVolcano,
  parse: parseJmaVolcano,
};
