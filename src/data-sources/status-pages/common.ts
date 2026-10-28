/**
 * Shared pieces of the status-page connectors (`cloud-status`, `app-status`):
 * the Atlassian Statuspage v2 incidents format, cloud-region coordinates and the
 * candidate builder. Incidents are first-party reports by each operator about itself.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { airportByCode, getCountry } from "@/lib/geo/gazetteer";
import { plainText, safeUrl } from "../types";
import { clip, makeSource } from "../official-common";

export interface Provider {
  id: string;
  name: string;
  url: string;
  page: string;
  hq: { lat: number; lon: number; name: string; country: string };
}

/** Atlassian Statuspage `/api/v2/incidents.json` (trimmed). */
export interface StatuspageIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  resolved_at?: string | null;
  shortlink?: string | null;
  components?: Array<{ name: string }>;
  incident_updates?: Array<{ status?: string; body?: string; created_at?: string }>;
}

/** Recent incidents: opened in the last 2 days, or still open (opened within 14 days). */
export const RECENT_MS = 2 * 86_400_000;
export const OPEN_MAX_MS = 14 * 86_400_000;

export function trimStatuspage(j: { incidents?: StatuspageIncident[] }): StatuspageIncident[] {
  return (j.incidents ?? []).slice(0, 50).map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status,
    impact: i.impact,
    created_at: i.created_at,
    updated_at: i.updated_at ?? null,
    started_at: i.started_at ?? null,
    resolved_at: i.resolved_at ?? null,
    shortlink: i.shortlink ?? null,
    components: (i.components ?? []).slice(0, 12).map((c) => ({ name: c.name })),
    incident_updates: (i.incident_updates ?? []).slice(0, 1).map((u) => ({ status: u.status, body: (u.body ?? "").slice(0, 1200), created_at: u.created_at })),
  }));
}

const IMPACT_RANK: Record<string, number> = { minor: 1, major: 2, critical: 3 };

export interface StatusCandidateInput {
  dataSourceId: string;
  type: EventCategory;
  provider: Provider;
  externalId: string;
  name: string;
  startedAt: string;
  resolvedAt: string | null;
  status: string;
  impact: string | null;
  components: string[];
  latestUpdate: string;
  url: string | null;
  place?: { lat: number; lon: number; name: string; country: string };
  retrievedAt: string;
  raw: unknown;
}

export function statusCandidate(o: StatusCandidateInput): EventCandidateInput {
  const place = o.place ?? o.provider.hq;
  const atHq = !o.place;
  const resolved = !!o.resolvedAt;
  const title = clip(`${o.provider.name} incident: ${plainText(o.name, 260)}`);
  return {
    type: o.type,
    subtype: "service incident",
    title,
    summary:
      `${o.provider.name} reported an incident on its status page at ${o.startedAt.slice(0, 16).replace("T", " ")} UTC` +
      `${o.impact ? ` (impact: ${o.impact})` : ""}; status: ${o.status}${resolved ? `, resolved ${o.resolvedAt!.slice(0, 16).replace("T", " ")} UTC` : ""}.` +
      `${o.components.length ? ` Affected: ${o.components.slice(0, 8).join(", ")}.` : ""}` +
      (atHq ? ` Shown at ${o.provider.name}'s headquarters; the service is used worldwide.` : ` Shown at the affected location (${place.name}).`),
    description: o.latestUpdate ? plainText(o.latestUpdate, 1500) : null,
    latitude: place.lat,
    longitude: place.lon,
    geoPrecision: atHq ? "city" : "region",
    locationName: place.name,
    country: place.country,
    timestamp: o.startedAt,
    resolvedAt: o.resolvedAt,
    metrics: { provider: o.provider.name, status: o.status, impact: o.impact, impact_rank: o.impact ? (IMPACT_RANK[o.impact] ?? null) : null, components: o.components.length },
    entities: [{ type: "ORGANIZATION", name: o.provider.name, code: null }],
    source: makeSource({
      dataSourceId: o.dataSourceId,
      externalId: o.externalId,
      sourceName: `${o.provider.name} status page`,
      sourceUrl: o.url ?? o.provider.page,
      title,
      publishedAt: o.startedAt,
      retrievedAt: o.retrievedAt,
      assertion: "OFFICIAL_PRELIMINARY",
      basis: `First-party status page operated by ${o.provider.name} (a company, reporting on its own service)`,
    }),
    rawData: o.raw,
  };
}

/** Statuspage incidents → candidates (impact "none" and maintenance skipped). */
type Located = { lat: number; lon: number; name: string; country: string };

/**
 * Cloudflare names data centres by city and IATA code ("Network Performance Issues in
 * Ashburn, IAD", "… in Lisbon (LIS)"): place those at the airport of that code.
 */
export function placeFromPop(name: string): Located | undefined {
  const m = name.match(/\bin ([A-Z][\p{L} .'-]{1,40}?),? \(?([A-Z]{3})\)?(?=$|[\s,.;)])/u) ?? name.match(/\b([A-Z][\p{L}.'-]{1,30}(?: [A-Z][\p{L}.'-]{1,30})?) \(([A-Z]{3})\)/u);
  const ap = m ? airportByCode(m[2]) : undefined;
  if (!m || !ap || !ap.large) return undefined;
  return { lat: ap.lat, lon: ap.lon, name: `${m[1].trim()} (${m[2]}), ${getCountry(ap.country)?.name ?? ap.country}`, country: ap.country };
}

export function parseStatuspage(
  dataSourceId: string,
  type: EventCategory,
  provider: Provider,
  incidents: StatuspageIncident[],
  now: number,
  retrievedAt: string,
  locate?: (name: string) => Located | undefined,
): { candidates: EventCandidateInput[]; skipped: number } {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const i of incidents) {
    const created = Date.parse(i.started_at && Date.parse(i.started_at) < Date.parse(i.created_at) ? i.started_at : i.created_at);
    const isResolved = i.status === "resolved" || i.status === "postmortem" || i.status === "completed";
    const age = now - created;
    if (!i.id || !i.name || Number.isNaN(created) || !IMPACT_RANK[i.impact] || age > (isResolved ? RECENT_MS : OPEN_MAX_MS)) {
      skipped++;
      continue;
    }
    const end = Date.parse(i.resolved_at ?? i.updated_at ?? i.created_at);
    const resolvedAt = isResolved ? new Date(Number.isNaN(end) ? created : Math.max(end, created)).toISOString() : null;
    candidates.push(
      statusCandidate({
        dataSourceId,
        type,
        provider,
        externalId: `${provider.id}:${i.id}`,
        name: i.name,
        startedAt: new Date(created).toISOString(),
        resolvedAt,
        status: i.status,
        impact: i.impact,
        components: (i.components ?? []).map((c) => c.name),
        latestUpdate: i.incident_updates?.[0]?.body ?? "",
        url: safeUrl(i.shortlink),
        place: locate?.(i.name),
        retrievedAt,
        raw: { provider: provider.id, id: i.id, status: i.status, impact: i.impact, created_at: i.created_at, resolved_at: i.resolved_at },
      }),
    );
  }
  return { candidates, skipped };
}

type RegionPlace = [lat: number, lon: number, name: string, country: string];

/** Approximate locations of cloud regions (metro of the region's data centres). */
export const CLOUD_REGIONS: Record<string, RegionPlace> = {
  // AWS
  "us-east-1": [39.04, -77.49, "N. Virginia (us-east-1)", "US"],
  "us-east-2": [39.96, -83.0, "Ohio (us-east-2)", "US"],
  "us-west-1": [37.77, -122.42, "N. California (us-west-1)", "US"],
  "us-west-2": [45.84, -119.7, "Oregon (us-west-2)", "US"],
  "us-gov-west-1": [45.84, -119.7, "GovCloud US-West", "US"],
  "us-gov-east-1": [39.96, -83.0, "GovCloud US-East", "US"],
  "ca-central-1": [45.5, -73.57, "Canada Central (ca-central-1)", "CA"],
  "ca-west-1": [51.05, -114.07, "Calgary (ca-west-1)", "CA"],
  "mx-central-1": [20.59, -100.39, "Mexico Central (mx-central-1)", "MX"],
  "sa-east-1": [-23.55, -46.63, "São Paulo (sa-east-1)", "BR"],
  "eu-west-1": [53.35, -6.26, "Ireland (eu-west-1)", "IE"],
  "eu-west-2": [51.51, -0.13, "London (eu-west-2)", "GB"],
  "eu-west-3": [48.86, 2.35, "Paris (eu-west-3)", "FR"],
  "eu-central-1": [50.11, 8.68, "Frankfurt (eu-central-1)", "DE"],
  "eu-central-2": [47.37, 8.54, "Zurich (eu-central-2)", "CH"],
  "eu-north-1": [59.33, 18.07, "Stockholm (eu-north-1)", "SE"],
  "eu-south-1": [45.46, 9.19, "Milan (eu-south-1)", "IT"],
  "eu-south-2": [41.65, -0.88, "Spain (eu-south-2)", "ES"],
  "me-south-1": [26.07, 50.56, "Bahrain (me-south-1)", "BH"],
  "me-central-1": [24.45, 54.38, "UAE (me-central-1)", "AE"],
  "il-central-1": [32.08, 34.78, "Tel Aviv (il-central-1)", "IL"],
  "af-south-1": [-33.92, 18.42, "Cape Town (af-south-1)", "ZA"],
  "ap-east-1": [22.32, 114.17, "Hong Kong (ap-east-1)", "HK"],
  "ap-south-1": [19.08, 72.88, "Mumbai (ap-south-1)", "IN"],
  "ap-south-2": [17.39, 78.49, "Hyderabad (ap-south-2)", "IN"],
  "ap-northeast-1": [35.68, 139.69, "Tokyo (ap-northeast-1)", "JP"],
  "ap-northeast-2": [37.57, 126.98, "Seoul (ap-northeast-2)", "KR"],
  "ap-northeast-3": [34.69, 135.5, "Osaka (ap-northeast-3)", "JP"],
  "ap-southeast-1": [1.35, 103.82, "Singapore (ap-southeast-1)", "SG"],
  "ap-southeast-2": [-33.87, 151.21, "Sydney (ap-southeast-2)", "AU"],
  "ap-southeast-3": [-6.2, 106.85, "Jakarta (ap-southeast-3)", "ID"],
  "ap-southeast-4": [-37.81, 144.96, "Melbourne (ap-southeast-4)", "AU"],
  "ap-southeast-5": [3.14, 101.69, "Malaysia (ap-southeast-5)", "MY"],
  // Google Cloud
  "us-central1": [41.26, -95.86, "Iowa (us-central1)", "US"],
  "us-east1": [33.2, -80.01, "South Carolina (us-east1)", "US"],
  "us-east4": [39.04, -77.49, "N. Virginia (us-east4)", "US"],
  "us-east5": [39.96, -83.0, "Columbus (us-east5)", "US"],
  "us-south1": [32.78, -96.8, "Dallas (us-south1)", "US"],
  "us-west1": [45.6, -121.18, "Oregon (us-west1)", "US"],
  "us-west2": [34.05, -118.24, "Los Angeles (us-west2)", "US"],
  "us-west3": [40.76, -111.89, "Salt Lake City (us-west3)", "US"],
  "us-west4": [36.17, -115.14, "Las Vegas (us-west4)", "US"],
  "northamerica-northeast1": [45.5, -73.57, "Montréal (northamerica-northeast1)", "CA"],
  "northamerica-northeast2": [43.65, -79.38, "Toronto (northamerica-northeast2)", "CA"],
  "southamerica-east1": [-23.55, -46.63, "São Paulo (southamerica-east1)", "BR"],
  "southamerica-west1": [-33.45, -70.67, "Santiago (southamerica-west1)", "CL"],
  "europe-west1": [50.45, 3.82, "Belgium (europe-west1)", "BE"],
  "europe-west2": [51.51, -0.13, "London (europe-west2)", "GB"],
  "europe-west3": [50.11, 8.68, "Frankfurt (europe-west3)", "DE"],
  "europe-west4": [53.44, 6.83, "Netherlands (europe-west4)", "NL"],
  "europe-west6": [47.37, 8.54, "Zurich (europe-west6)", "CH"],
  "europe-west8": [45.46, 9.19, "Milan (europe-west8)", "IT"],
  "europe-west9": [48.86, 2.35, "Paris (europe-west9)", "FR"],
  "europe-west10": [52.52, 13.4, "Berlin (europe-west10)", "DE"],
  "europe-west12": [45.07, 7.69, "Turin (europe-west12)", "IT"],
  "europe-north1": [60.57, 27.2, "Finland (europe-north1)", "FI"],
  "europe-central2": [52.23, 21.01, "Warsaw (europe-central2)", "PL"],
  "europe-southwest1": [40.42, -3.7, "Madrid (europe-southwest1)", "ES"],
  "asia-east1": [24.08, 120.54, "Taiwan (asia-east1)", "TW"],
  "asia-east2": [22.32, 114.17, "Hong Kong (asia-east2)", "HK"],
  "asia-northeast1": [35.68, 139.69, "Tokyo (asia-northeast1)", "JP"],
  "asia-northeast2": [34.69, 135.5, "Osaka (asia-northeast2)", "JP"],
  "asia-northeast3": [37.57, 126.98, "Seoul (asia-northeast3)", "KR"],
  "asia-south1": [19.08, 72.88, "Mumbai (asia-south1)", "IN"],
  "asia-south2": [28.61, 77.21, "Delhi (asia-south2)", "IN"],
  "asia-southeast1": [1.35, 103.82, "Singapore (asia-southeast1)", "SG"],
  "asia-southeast2": [-6.2, 106.85, "Jakarta (asia-southeast2)", "ID"],
  "australia-southeast1": [-33.87, 151.21, "Sydney (australia-southeast1)", "AU"],
  "australia-southeast2": [-37.81, 144.96, "Melbourne (australia-southeast2)", "AU"],
  "me-west1": [32.08, 34.78, "Tel Aviv (me-west1)", "IL"],
  "me-central1": [25.29, 51.53, "Doha (me-central1)", "QA"],
  "me-central2": [26.43, 50.1, "Dammam (me-central2)", "SA"],
  "africa-south1": [-26.2, 28.05, "Johannesburg (africa-south1)", "ZA"],
};

export function regionPlace(code: string | null | undefined): { lat: number; lon: number; name: string; country: string } | undefined {
  const r = code ? CLOUD_REGIONS[code.toLowerCase()] : undefined;
  return r ? { lat: r[0], lon: r[1], name: r[2], country: r[3] } : undefined;
}
