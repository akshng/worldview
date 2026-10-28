/**
 * Cloud / internet infrastructure incidents from the operators' public status feeds:
 * AWS Health Dashboard RSS, Google Cloud `incidents.json`, Azure status RSS, and the
 * Statuspage APIs of Cloudflare and DigitalOcean. Recent or still-open incidents only;
 * a resolved incident carries `resolvedAt`, which resolves the event.
 */
import type { EventCandidateInput } from "@/types/events";
import { decodeXmlText, parseFeedXml } from "../news-rss/client";
import type { DataSourceConnector, FetchContext, ParseContext, ParseResult } from "../types";
import { fetchEach } from "../official-common";
import { OPEN_MAX_MS, RECENT_MS, parseStatuspage, placeFromPop, regionPlace, statusCandidate, trimStatuspage, type Provider, type StatuspageIncident } from "./common";

const DS = "cloud-status";

export const CLOUD_PROVIDERS = {
  aws: { id: "aws", name: "AWS", url: "https://status.aws.amazon.com/rss/all.rss", page: "https://health.aws.amazon.com/health/status", hq: { lat: 47.6223, lon: -122.3366, name: "Amazon Web Services, Seattle", country: "US" } },
  gcp: { id: "gcp", name: "Google Cloud", url: "https://status.cloud.google.com/incidents.json", page: "https://status.cloud.google.com/", hq: { lat: 37.422, lon: -122.0841, name: "Google, Mountain View, CA", country: "US" } },
  azure: { id: "azure", name: "Microsoft Azure", url: "https://azurestatuscdn.azureedge.net/en-us/status/feed/", page: "https://azure.status.microsoft/en-us/status", hq: { lat: 47.6396, lon: -122.1283, name: "Microsoft, Redmond, WA", country: "US" } },
  cloudflare: { id: "cloudflare", name: "Cloudflare", url: "https://www.cloudflarestatus.com/api/v2/incidents.json", page: "https://www.cloudflarestatus.com/", hq: { lat: 37.7802, lon: -122.3917, name: "Cloudflare, San Francisco", country: "US" } },
  digitalocean: { id: "digitalocean", name: "DigitalOcean", url: "https://status.digitalocean.com/api/v2/incidents.json", page: "https://status.digitalocean.com/", hq: { lat: 40.7128, lon: -74.006, name: "DigitalOcean, New York", country: "US" } },
} satisfies Record<string, Provider>;

export interface AwsItem {
  title: string;
  guid: string;
  published: string | null;
  description: string;
}
export interface GcpIncident {
  id: string;
  begin: string;
  end?: string | null;
  external_desc: string;
  severity?: string;
  status_impact?: string;
  service_name?: string;
  uri?: string;
  affected_products?: Array<{ title: string }>;
  most_recent_update?: { text?: string; status?: string };
  currently_affected_locations?: Array<{ id: string; title?: string }>;
  previously_affected_locations?: Array<{ id: string; title?: string }>;
}
export interface CloudStatusRaw {
  aws?: AwsItem[];
  gcp?: GcpIncident[];
  azure?: Array<{ title: string; link: string; description: string; published: string | null }>;
  statuspage?: Array<{ provider: "cloudflare" | "digitalocean"; incidents: StatuspageIncident[] }>;
}

/** AWS items need their guid ("#service-region_epoch"), which the generic reader drops. */
export function parseAwsRss(xml: string): AwsItem[] {
  const out: AwsItem[] = [];
  for (const b of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const get = (n: string) => decodeXmlText(b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i"))?.[1] ?? "").trim();
    const guid = get("guid");
    if (guid) out.push({ title: get("title"), guid, published: get("pubDate") || null, description: get("description").slice(0, 1500) });
  }
  return out;
}

export async function fetchCloudStatus(ctx: FetchContext): Promise<CloudStatusRaw> {
  const feeds = Object.values(CLOUD_PROVIDERS);
  const ok = await fetchEach(ctx, feeds, async (res, feed): Promise<CloudStatusRaw> => {
    if (feed.id === "aws") return { aws: parseAwsRss(await res.text()).slice(0, 80) };
    if (feed.id === "azure") return { azure: parseFeedXml(await res.text()).slice(0, 40) };
    const j = (await res.json()) as unknown;
    if (feed.id === "gcp") return { gcp: (Array.isArray(j) ? (j as GcpIncident[]) : []).slice(0, 40).map((i) => ({ ...i, updates: undefined })) };
    return { statuspage: [{ provider: feed.id as "cloudflare" | "digitalocean", incidents: trimStatuspage(j as { incidents?: StatuspageIncident[] }) }] };
  }, "application/json, application/rss+xml, application/xml, text/xml");
  const raw: CloudStatusRaw = {};
  for (const { data } of ok) {
    raw.aws ??= data.aws;
    raw.azure ??= data.azure;
    raw.gcp ??= data.gcp;
    if (data.statuspage) raw.statuspage = [...(raw.statuspage ?? []), ...data.statuspage];
  }
  return raw;
}

const AWS_RESOLVED = /operating normally|\[RESOLVED\]/i;
/** Updates to one service/region more than this far apart are separate incidents. */
const AWS_GAP_MS = 24 * 3_600_000;

/** Group AWS updates into incidents per service/region; one candidate per incident. */
export function parseAws(items: AwsItem[], now: number, retrievedAt: string): { candidates: EventCandidateInput[]; skipped: number } {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const byKey = new Map<string, Array<AwsItem & { t: number }>>();
  for (const it of items) {
    const key = it.guid.match(/#([^#]+?)_(\d+)$/)?.[1];
    const t = it.published ? Date.parse(it.published) : NaN;
    if (!key || Number.isNaN(t)) {
      skipped++;
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), { ...it, t }]);
  }
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.t - b.t);
    const clusters: Array<typeof list> = [];
    for (const it of list) {
      const last = clusters.at(-1);
      if (last && it.t - last.at(-1)!.t <= AWS_GAP_MS) last.push(it);
      else clusters.push([it]);
    }
    for (const c of clusters) {
      const first = c[0];
      const latest = c.at(-1)!;
      const resolved = AWS_RESOLVED.test(latest.title);
      if (now - latest.t > (resolved ? RECENT_MS : OPEN_MAX_MS)) {
        skipped += c.length;
        continue;
      }
      skipped += c.length - 1;
      const region = key.match(/((?:[a-z]{2}-gov|[a-z]{2})-[a-z]+-\d)$/)?.[1] ?? null;
      const service = region ? key.slice(0, -region.length - 1) : key;
      const name = first.title.replace(/^[^:]{3,40}:\s*/, "").replace(/^\[RESOLVED\]\s*/i, "") || first.title;
      candidates.push(
        statusCandidate({
          dataSourceId: DS,
          type: "INFRASTRUCTURE",
          provider: CLOUD_PROVIDERS.aws,
          externalId: `aws:${key}_${first.guid.match(/_(\d+)$/)?.[1] ?? first.t}`,
          name: `${name} (${service}${region ? `, ${region}` : ""})`,
          startedAt: new Date(first.t).toISOString(),
          resolvedAt: resolved ? new Date(latest.t).toISOString() : null,
          status: latest.title.split(":")[0] || "reported",
          impact: null,
          components: [service],
          latestUpdate: latest.description,
          url: CLOUD_PROVIDERS.aws.page,
          place: regionPlace(region),
          retrievedAt,
          raw: { key, updates: c.length, first: first.published, latest: latest.published },
        }),
      );
    }
  }
  return { candidates, skipped };
}

const GCP_IMPACT: Record<string, string> = { low: "minor", medium: "major", high: "critical" };

export function parseGcp(incidents: GcpIncident[], now: number, retrievedAt: string): { candidates: EventCandidateInput[]; skipped: number } {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const i of incidents) {
    const begin = Date.parse(i.begin);
    const end = i.end ? Date.parse(i.end) : NaN;
    const open = Number.isNaN(end);
    if (!i.id || Number.isNaN(begin) || now - (open ? begin : end) > (open ? OPEN_MAX_MS : RECENT_MS) || i.status_impact === "SERVICE_INFORMATION") {
      skipped++;
      continue;
    }
    const locs = [...new Set([...(i.currently_affected_locations ?? []), ...(i.previously_affected_locations ?? [])].map((l) => l.id))];
    const places = locs.map(regionPlace).filter((p): p is NonNullable<typeof p> => !!p);
    const onlyRegional = places.length === 1 && !locs.includes("global");
    candidates.push(
      statusCandidate({
        dataSourceId: DS,
        type: "INFRASTRUCTURE",
        provider: CLOUD_PROVIDERS.gcp,
        externalId: `gcp:${i.id}`,
        name: `${i.service_name ? `${i.service_name} — ` : ""}${i.external_desc}`,
        startedAt: new Date(begin).toISOString(),
        resolvedAt: open ? null : new Date(end).toISOString(),
        status: open ? (i.most_recent_update?.status ?? "open").toLowerCase() : "resolved",
        impact: (i.severity && GCP_IMPACT[i.severity]) ?? null,
        components: [...(i.affected_products ?? []).map((p) => p.title).slice(0, 10), ...(locs.length ? [`locations: ${locs.join(", ")}`] : [])],
        latestUpdate: i.most_recent_update?.text ?? "",
        url: i.uri ? `https://status.cloud.google.com/${i.uri.replace(/^\//, "")}` : null,
        place: onlyRegional ? places[0] : undefined,
        retrievedAt,
        raw: { id: i.id, begin: i.begin, end: i.end ?? null, severity: i.severity, locations: locs },
      }),
    );
  }
  return { candidates, skipped };
}

export function parseCloudStatus(raw: CloudStatusRaw, ctx: ParseContext): ParseResult {
  const parts = [
    parseAws(raw.aws ?? [], ctx.now, ctx.retrievedAt),
    parseGcp(raw.gcp ?? [], ctx.now, ctx.retrievedAt),
    ...(raw.statuspage ?? []).map((s) => parseStatuspage(DS, "INFRASTRUCTURE", CLOUD_PROVIDERS[s.provider], s.incidents, ctx.now, ctx.retrievedAt, s.provider === "cloudflare" ? placeFromPop : undefined)),
  ];
  // Azure's feed lists only incidents in progress; it has no ids or end times.
  const azure: EventCandidateInput[] = [];
  let azureSkipped = 0;
  for (const it of raw.azure ?? []) {
    const t = it.published ? Date.parse(it.published) : NaN;
    if (!it.title || Number.isNaN(t) || ctx.now - t > OPEN_MAX_MS) {
      azureSkipped++;
      continue;
    }
    azure.push(
      statusCandidate({
        dataSourceId: DS,
        type: "INFRASTRUCTURE",
        provider: CLOUD_PROVIDERS.azure,
        externalId: `azure:${new Date(t).toISOString().slice(0, 10)}:${it.title.toLowerCase().replace(/\W+/g, "-").slice(0, 80)}`,
        name: it.title,
        startedAt: new Date(t).toISOString(),
        resolvedAt: null,
        status: "active",
        impact: null,
        components: [],
        latestUpdate: it.description,
        url: it.link || null,
        retrievedAt: ctx.retrievedAt,
        raw: { title: it.title, published: it.published },
      }),
    );
  }
  return { candidates: [...parts.flatMap((p) => p.candidates), ...azure], skipped: parts.reduce((n, p) => n + p.skipped, azureSkipped) };
}

export const cloudStatusConnector: DataSourceConnector<CloudStatusRaw> = {
  id: DS,
  name: "Cloud & CDN outages",
  description: "Recent and open incidents on the AWS, Google Cloud, Azure, Cloudflare and DigitalOcean status pages, at the affected cloud region when one is named.",
  homepage: "https://health.aws.amazon.com/health/status",
  attribution: "Public status pages of Amazon Web Services, Google Cloud, Microsoft Azure, Cloudflare and DigitalOcean; link back to each incident",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["INFRASTRUCTURE"],
  refreshIntervalMs: 5 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchCloudStatus,
  parse: parseCloudStatus,
};
