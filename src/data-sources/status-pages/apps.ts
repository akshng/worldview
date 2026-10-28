/**
 * Major online services' incidents from their public status pages: Statuspage v2 APIs
 * (GitHub, Discord, OpenAI, Claude, Zoom, Shopify, Atlassian, Reddit) and Slack's status
 * API. Recent or still-open incidents only; resolved ones carry `resolvedAt`.
 */
import type { EventCandidateInput } from "@/types/events";
import { safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { fetchEach } from "../official-common";
import { OPEN_MAX_MS, RECENT_MS, parseStatuspage, statusCandidate, trimStatuspage, type Provider, type StatuspageIncident } from "./common";

const DS = "app-status";
const SF = (name: string, lat = 37.7897, lon = -122.3972) => ({ lat, lon, name: `${name}, San Francisco`, country: "US" });

export const APP_PROVIDERS: Provider[] = [
  { id: "github", name: "GitHub", url: "https://www.githubstatus.com/api/v2/incidents.json", page: "https://www.githubstatus.com/", hq: SF("GitHub", 37.7823, -122.3915) },
  { id: "discord", name: "Discord", url: "https://discordstatus.com/api/v2/incidents.json", page: "https://discordstatus.com/", hq: SF("Discord", 37.7706, -122.3871) },
  { id: "openai", name: "OpenAI", url: "https://status.openai.com/api/v2/incidents.json", page: "https://status.openai.com/", hq: SF("OpenAI", 37.7623, -122.4148) },
  { id: "claude", name: "Claude (Anthropic)", url: "https://status.claude.com/api/v2/incidents.json", page: "https://status.claude.com/", hq: SF("Anthropic") },
  { id: "zoom", name: "Zoom", url: "https://www.zoomstatus.com/api/v2/incidents.json", page: "https://www.zoomstatus.com/", hq: { lat: 37.3337, lon: -121.89, name: "Zoom, San Jose, CA", country: "US" } },
  { id: "shopify", name: "Shopify", url: "https://www.shopifystatus.com/api/v2/incidents.json", page: "https://www.shopifystatus.com/", hq: { lat: 45.4215, lon: -75.6972, name: "Shopify, Ottawa", country: "CA" } },
  { id: "atlassian", name: "Atlassian", url: "https://status.atlassian.com/api/v2/incidents.json", page: "https://status.atlassian.com/", hq: { lat: -33.8688, lon: 151.2093, name: "Atlassian, Sydney", country: "AU" } },
  { id: "reddit", name: "Reddit", url: "https://www.redditstatus.com/api/v2/incidents.json", page: "https://www.redditstatus.com/", hq: SF("Reddit", 37.7786, -122.3893) },
  { id: "slack", name: "Slack", url: "https://slack-status.com/api/v2.0.0/history", page: "https://slack-status.com/", hq: SF("Slack", 37.7899, -122.3969) },
];

/** Slack status API v2 history entry. */
export interface SlackIncident {
  id: number;
  title: string;
  type: string;
  status: string;
  url?: string;
  date_created: string;
  date_updated?: string;
  notes?: Array<{ body?: string; date_created?: string }>;
  services?: string[];
}
export interface AppStatusRaw {
  statuspage: Array<{ provider: string; incidents: StatuspageIncident[] }>;
  slack?: SlackIncident[];
}

export async function fetchAppStatus(ctx: FetchContext, providers: Provider[] = APP_PROVIDERS): Promise<AppStatusRaw> {
  const ok = await fetchEach(ctx, providers, async (res) => (await res.json()) as unknown, "application/json");
  const raw: AppStatusRaw = { statuspage: [] };
  for (const { feed, data } of ok) {
    if (feed.id === "slack") raw.slack = (Array.isArray(data) ? (data as SlackIncident[]) : []).slice(0, 30).map((i) => ({ ...i, notes: (i.notes ?? []).slice(0, 1) }));
    else raw.statuspage.push({ provider: feed.id, incidents: trimStatuspage(data as { incidents?: StatuspageIncident[] }) });
  }
  return raw;
}

export function parseSlack(incidents: SlackIncident[], now: number, retrievedAt: string): { candidates: EventCandidateInput[]; skipped: number } {
  const slack = APP_PROVIDERS.find((p) => p.id === "slack")!;
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const i of incidents) {
    const t = Date.parse(i.date_created);
    const resolved = i.status === "resolved";
    const end = Date.parse(i.date_updated ?? i.date_created);
    // Slack also lists planned maintenance ("notice"/"maintenance"): incidents and outages only.
    if (!i.id || !i.title || Number.isNaN(t) || !/^(incident|outage)$/.test(i.type) || now - (resolved ? end : t) > (resolved ? RECENT_MS : OPEN_MAX_MS)) {
      skipped++;
      continue;
    }
    candidates.push(
      statusCandidate({
        dataSourceId: DS,
        type: "TECHNOLOGY",
        provider: slack,
        externalId: `slack:${i.id}`,
        name: i.title,
        startedAt: new Date(t).toISOString(),
        resolvedAt: resolved ? new Date(Math.max(t, Number.isNaN(end) ? t : end)).toISOString() : null,
        status: i.status,
        impact: i.type === "outage" ? "major" : null,
        components: i.services ?? [],
        latestUpdate: i.notes?.[0]?.body ?? "",
        url: safeUrl(i.url),
        retrievedAt,
        raw: { id: i.id, type: i.type, status: i.status, date_created: i.date_created },
      }),
    );
  }
  return { candidates, skipped };
}

export function parseAppStatus(raw: AppStatusRaw, ctx: ParseContext): ParseResult {
  const parts = [
    ...(raw.statuspage ?? []).flatMap((s) => {
      const p = APP_PROVIDERS.find((x) => x.id === s.provider);
      return p ? [parseStatuspage(DS, "TECHNOLOGY", p, s.incidents, ctx.now, ctx.retrievedAt)] : [];
    }),
    parseSlack(raw.slack ?? [], ctx.now, ctx.retrievedAt),
  ];
  return { candidates: parts.flatMap((p) => p.candidates), skipped: parts.reduce((n, p) => n + p.skipped, 0) };
}

export const appStatusConnector: DataSourceConnector<AppStatusRaw> = {
  id: DS,
  name: "Online service outages",
  description: "Recent and open incidents on the status pages of GitHub, Slack, Discord, OpenAI, Claude, Zoom, Shopify, Atlassian and Reddit, at each company's headquarters.",
  homepage: "https://www.githubstatus.com/",
  attribution: "Public status pages of each service (Atlassian Statuspage API, Slack status API); link back to each incident",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["TECHNOLOGY"],
  refreshIntervalMs: 10 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: (ctx) => fetchAppStatus(ctx),
  parse: parseAppStatus,
};
