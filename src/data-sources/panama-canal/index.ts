/**
 * Panama Canal Authority (Autoridad del Canal de Panamá, ACP) news RSS, English edition
 * (keyless WordPress feed). Draft limits, daily transit slots, booking-system changes, water
 * levels, tolls and traffic figures move shipping and freight rates, so every release of the
 * last 30 days is kept; operational ones (draft, transits, slots, water, tolls, restrictions)
 * are labelled "canal operations". Shown at the canal (Panama Canal Administration Building,
 * Balboa). Tracking parameters (`utm_*`) are removed from links.
 */
import { agencyConnector, fetchAgencyFeeds, type AgencyFeed, type AgencyFeedsRaw, type AgencySpec } from "../agency-feeds/common";

const ACP = { lat: 8.9604, lon: -79.5536, name: "Panama Canal Administration Building, Balboa, Panama", country: "PA" };

export const PANAMA_FEEDS: AgencyFeed[] = [
  {
    id: "acp",
    name: "Panama Canal Authority",
    alias: /\bPanama Canal\b|\bACP\b/i,
    url: "https://pancanal.com/en/feed/",
    place: ACP,
    basis: "Autonomous agency of the Republic of Panama that operates the canal (official releases)",
  },
];

export const CANAL_OPS = /\b(draft|draught|transits?|slots?|booking|LoTSA|reservations?|water (level|supply|saving)|Gat[uú]n|lake level|drought|El Ni[nñ]o|tolls?|restrictions?|locks?|tonnage|Neopanamax|Panamax|queue|waiting)\b/i;

/** Remove `utm_*` tracking parameters from a link. */
export function stripTracking(link: string): string {
  try {
    const u = new URL(link.trim());
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return link;
  }
}

export const panamaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "panama-canal",
  feeds: PANAMA_FEEDS,
  maxAgeMs: 30 * 86_400_000,
  classify: ({ title, description }) => {
    const ops = CANAL_OPS.test(title) || CANAL_OPS.test(description.slice(0, 400));
    return { type: "MARITIME", subtype: ops ? "canal operations" : "canal authority news" };
  },
};

const base = agencyConnector(panamaSpec, {
  name: "Panama Canal Authority",
  description: "Panama Canal Authority releases (draft limits, transit slots, water levels, tolls, traffic), last 30 days; shown at the canal.",
  homepage: "https://pancanal.com/en/",
  attribution: "Autoridad del Canal de Panamá — pancanal.com RSS; headline, short excerpt and link only",
  categories: ["MARITIME"],
  refreshIntervalMs: 60 * 60_000,
});

export async function fetchPanama(ctx: Parameters<typeof base.fetch>[0]): Promise<AgencyFeedsRaw> {
  const raw = await fetchAgencyFeeds(ctx, PANAMA_FEEDS, 40);
  return { feeds: raw.feeds.map((f) => ({ ...f, items: f.items.map((it) => ({ ...it, link: it.link ? stripTracking(it.link) : it.link })) })) };
}

export const panamaCanalConnector = { ...base, fetch: fetchPanama };
