/**
 * WHO Regional Office for Africa (WHO AFRO) featured-news RSS (keyless). The feed mixes
 * outbreak responses with routine programme news; only items about an outbreak, epidemic,
 * vaccination campaign against an epidemic disease or a health emergency are kept (the
 * `who` connector carries WHO's global Disease Outbreak News; this adds the regional
 * office's field reporting, often days earlier and naming districts).
 *
 * Placed in the African country the headline names (country label point), else at the
 * regional office in Brazzaville. The feed's description is not stored: it holds only the
 * title again, the author's (truncated) email address and dates.
 */
import { placesInText } from "@/lib/geo/headline-places";
import { agencyConnector, fetchAgencyFeeds, type AgencyFeed, type AgencyFeedsRaw, type AgencySpec, type Located } from "../agency-feeds/common";

const AFRO = { lat: -4.2955, lon: 15.2287, name: "WHO Regional Office for Africa, Brazzaville, Congo", country: "CG" };

export const AFRO_FEEDS: AgencyFeed[] = [
  {
    id: "afro",
    name: "WHO Regional Office for Africa",
    alias: /\bWHO\b|\bWorld Health Organization\b/,
    prefix: "WHO Africa",
    url: "https://www.afro.who.int/rss/featured-news.xml",
    place: AFRO,
    basis: "World Health Organization regional office (UN specialised agency)",
  },
];

export const OUTBREAK =
  /\b(outbreaks?|epidemics?|cholera|mpox|monkeypox|ebola|marburg|bundibugyo|sudan virus|lassa|yellow fever|meningitis|cVDPV\d?|poliovirus|(polio|measles)( outbreaks?| cases?| vaccination campaigns?| immuni[sz]ation campaigns?)|diphtheria|dengue|chikungunya|anthrax|plague|rift valley|avian influenza|h5n1|nipah|hepatitis e|typhoid|malaria (surge|upsurge|outbreak)|health emergenc(y|ies)|public health emergency|grade 3 emergency|disease (response|surveillance)|virus disease|case fatality|confirmed cases?|deaths? from)\b/i;

/** Disease named in the headline, for the subtype. */
export function afroDisease(title: string): string | null {
  const m = title.match(/\b(cholera|mpox|ebola|marburg|bundibugyo virus disease|sudan virus disease|lassa fever|yellow fever|meningitis|measles|polio|diphtheria|dengue|chikungunya|anthrax|plague|rift valley fever|avian influenza|h5n1|nipah|hepatitis e|typhoid|malaria)\b/i);
  return m ? m[1].toLowerCase() : null;
}

/** First African (or any) country the headline names, at its label point. */
export function afroPlace(title: string): Located | null {
  const places = placesInText(title);
  const p = places.find((x) => x.cued) ?? places[0];
  if (!p) return null;
  const [lon, lat] = p.city ? [p.city.lon, p.city.lat] : p.country.label;
  const name = p.city ? `${p.city.name}, ${p.country.name}` : p.country.name;
  return { lat, lon, name, country: p.country.code, precision: p.city ? "city" : "country", note: ` Shown in ${p.country.name}, which the headline names; published by the WHO Regional Office for Africa.` };
}

export const afroSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "who-afro",
  feeds: AFRO_FEEDS,
  maxAgeMs: 14 * 86_400_000,
  // The feed repeats a story under several links within minutes; one event per title.
  idKey: ({ title }) => title.toLowerCase().replace(/\s+/g, " ").trim(),
  classify: ({ title }) => {
    if (!OUTBREAK.test(title)) return null;
    const disease = afroDisease(title);
    return { type: "HEALTH", subtype: disease ? `${disease} (WHO Africa)` : "health emergency (WHO Africa)", located: afroPlace(title), metrics: { disease } };
  },
};

const base = agencyConnector(afroSpec, {
  name: "WHO Africa outbreak news",
  description: "WHO Regional Office for Africa news about outbreaks, epidemics and health emergencies (last 14 days), in the country the headline names.",
  homepage: "https://www.afro.who.int/news",
  attribution: "World Health Organization Regional Office for Africa — afro.who.int RSS; headline and link only",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
});

export async function fetchAfro(ctx: Parameters<typeof base.fetch>[0]): Promise<AgencyFeedsRaw> {
  const raw = await fetchAgencyFeeds(ctx, AFRO_FEEDS, 60);
  return { feeds: raw.feeds.map((f) => ({ ...f, items: f.items.map((it) => ({ ...it, description: "" })) })) };
}

export const whoAfroConnector = { ...base, fetch: fetchAfro };
