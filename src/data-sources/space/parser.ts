import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { Ll2Launch, SpaceRaw } from "./types";

const WINDOW_MS = 7 * 86_400_000;

function toCandidate(l: Ll2Launch, ctx: ParseContext): EventCandidateInput | null {
  const lat = Number(l.pad?.latitude), lon = Number(l.pad?.longitude);
  const t = Date.parse(l.net);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) return null;
  if (Math.abs(t - ctx.now) > WINDOW_MS) return null;
  const status = l.status?.name ?? "Unknown";
  const done = /success|failure|partial/i.test(status);
  const provider = l.launch_service_provider?.name ?? "Unknown provider";
  const rocket = l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? "rocket";
  const mission = l.mission?.name ?? l.name;
  const where = l.pad?.location?.name ?? l.pad?.name ?? "unknown site";
  const when = new Date(t).toISOString().slice(0, 16).replace("T", " ");
  const precision = l.net_precision?.name;
  const summary = done
    ? `${provider} ${rocket} launch of ${mission} from ${where} at ${when} UTC. Status reported by Launch Library 2: ${status}.` +
      (l.failreason ? ` Failure reason: ${plainText(l.failreason, 300)}` : "")
    : `${provider} plans to launch ${mission} on a ${rocket} from ${where}. Scheduled (NET) ${when} UTC` +
      `${precision ? ` (precision: ${precision.toLowerCase()})` : ""}. Current status: ${status}.`;
  return {
    type: "SPACE",
    subtype: "launch",
    title: `${done ? "" : "Scheduled: "}${rocket} — ${mission}`,
    summary,
    description: plainText(l.mission?.description, 1200) || null,
    latitude: lat,
    longitude: lon,
    geoPrecision: "exact",
    locationName: where,
    country: l.pad?.country?.alpha_2_code ?? null,
    timestamp: new Date(t).toISOString(),
    metrics: {
      launch_status: status,
      provider,
      rocket,
      mission,
      orbit: l.mission?.orbit?.name ?? null,
      pad: l.pad?.name ?? null,
      // Derived from LL2 mission type, not an independent crew manifest.
      crewed: /human exploration|tourism/i.test(l.mission?.type ?? ""),
    },
    entities: [
      { type: "ORGANIZATION", name: provider, code: null },
      { type: "VEHICLE", name: rocket, code: null },
    ],
    source: {
      id: `ll2:${l.id}`,
      dataSourceId: "space",
      externalId: l.id,
      sourceName: "Launch Library 2 (The Space Devs)",
      sourceUrl: safeUrl(l.url),
      title: l.name,
      titleIsDerived: false,
      publishedAt: new Date(l.last_updated).toISOString(),
      retrievedAt: ctx.retrievedAt,
      sourceType: "COMMUNITY_DATABASE",
      assertion: "SCHEDULED",
      credibility: { basis: "Community-maintained launch database" },
    },
    rawData: { id: l.id, name: l.name, status, net: l.net, window_start: l.window_start, window_end: l.window_end },
  };
}

export function parseLaunches(raw: SpaceRaw, ctx: ParseContext): ParseResult {
  const all = [...raw.upcoming, ...raw.previous];
  const candidates = all.map((l) => toCandidate(l, ctx)).filter((c): c is EventCandidateInput => c !== null);
  return { candidates, skipped: all.length - candidates.length };
}
