/**
 * INMET (Instituto Nacional de Meteorologia, Brazil) weather warnings, from the keyless JSON
 * behind avisos.inmet.gov.br (`apiprevmet3.inmet.gov.br/avisos/ativos`): today's and upcoming
 * warnings, each with its CAP polygon, states and municipalities. Only the two upper levels
 * of INMET's three-level scale become events — "Perigo" (orange) and "Grande Perigo" (red);
 * "Perigo Potencial" (yellow) is skipped as routine, like Meteoalarm yellow.
 *
 * INMET gives warning start/end as Brasília wall-clock time (UTC−3, no DST since 2019). The
 * event time is the warning start; it ends at the warning end. A later sequence of the same
 * warning (`id_aviso`) supersedes the earlier one.
 */
import type { AreaGeometry, EventCandidateInput, EventCategory } from "@/types/events";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { polygonCentroid, simplifyArea } from "../weather/parser";
import type { NwsAlertFeature } from "../weather/types";
import { clip } from "../official-common";

export interface InmetAviso {
  id?: number;
  id_aviso?: number;
  id_sequencia?: number;
  codigo?: string;
  inicio?: string;
  fim?: string;
  poligono?: string | null;
  estados?: string | null;
  mesorregioes?: string | null;
  microrregioes?: string | null;
  municipios?: string | null;
  descricao?: string;
  severidade?: string;
  aviso_cor?: string;
  riscos?: string[];
  instrucoes?: string[];
  encerrado?: boolean;
  [k: string]: unknown;
}
export interface InmetRaw {
  hoje?: InmetAviso[];
  futuro?: InmetAviso[];
}

const URL_ATIVOS = "https://apiprevmet3.inmet.gov.br/avisos/ativos";

export async function fetchInmet(ctx: FetchContext): Promise<InmetRaw> {
  const json = (await (await httpGet(URL_ATIVOS, ctx)).json()) as InmetRaw;
  // Drop the base64 icons and the long municipality-code lists before storing the raw record.
  const slim = (xs: InmetAviso[] | undefined) =>
    (xs ?? []).map((a) => ({ id: a.id, id_aviso: a.id_aviso, id_sequencia: a.id_sequencia, codigo: a.codigo, inicio: a.inicio, fim: a.fim, poligono: a.poligono, estados: a.estados, mesorregioes: a.mesorregioes, municipios: a.municipios, descricao: a.descricao, severidade: a.severidade, aviso_cor: a.aviso_cor, riscos: a.riscos, instrucoes: a.instrucoes, encerrado: a.encerrado }));
  return { hoje: slim(json.hoje), futuro: slim(json.futuro) };
}

const LEVEL: Record<string, { level: number; colour: string; en: string }> = {
  "grande perigo": { level: 3, colour: "red", en: "great danger" },
  perigo: { level: 2, colour: "orange", en: "danger" },
  "perigo potencial": { level: 1, colour: "yellow", en: "potential danger" },
};

/** INMET event name (Portuguese) → English label, category, subtype. */
export function inmetEvent(desc: string): { en: string; type: EventCategory; subtype: string } {
  const d = desc.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/tempestade/.test(d)) return { en: "Storm", type: "WEATHER", subtype: "thunderstorm" };
  if (/chuva|acumulado/.test(d)) return { en: d.includes("acumulado") ? "Heavy rainfall accumulation" : "Heavy rain", type: "WEATHER", subtype: "heavy-rain" };
  if (/vendaval|ventos/.test(d)) return { en: d.includes("costeiro") ? "Coastal winds" : "Gale", type: "WEATHER", subtype: "wind" };
  if (/onda de calor/.test(d)) return { en: "Heat wave", type: "WEATHER", subtype: "extreme-heat" };
  if (/onda de frio|declinio de temperatura|geada|neve|nevasca/.test(d)) return { en: d.includes("geada") ? "Frost" : d.includes("onda de frio") ? "Cold wave" : /neve|nevasca/.test(d) ? "Snow" : "Temperature drop", type: "WEATHER", subtype: "winter" };
  if (/baixa umidade/.test(d)) return { en: "Low humidity", type: "WEATHER", subtype: "low-humidity" };
  if (/granizo/.test(d)) return { en: "Hail", type: "WEATHER", subtype: "hail" };
  if (/ressaca|\bmar\b/.test(d)) return { en: "Rough seas", type: "WEATHER", subtype: "coastal" };
  if (/inundac|alagamento/.test(d)) return { en: "Flooding", type: "FLOOD", subtype: "flood" };
  return { en: desc, type: "WEATHER", subtype: "weather" };
}

/** "2026-11-07 00:01" (Brasília, UTC−3) → ISO. */
export function inmetTime(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 3, Number(m[5]))).toISOString();
}

function readPolygon(s: string | null | undefined): AreaGeometry | null {
  if (!s) return null;
  try {
    const g = JSON.parse(s) as AreaGeometry;
    return (g?.type === "Polygon" || g?.type === "MultiPolygon") && Array.isArray(g.coordinates) && g.coordinates.length ? g : null;
  } catch {
    return null;
  }
}

const list = (s: string | null | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function parseInmet(raw: InmetRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const a of [...(raw.hoje ?? []), ...(raw.futuro ?? [])]) {
    const lvl = LEVEL[(a.severidade ?? "").trim().toLowerCase()];
    const start = inmetTime(a.inicio);
    const end = inmetTime(a.fim);
    const geom = readPolygon(a.poligono);
    const c = geom ? polygonCentroid(geom as NonNullable<NwsAlertFeature["geometry"]>) : null;
    const key = a.id_aviso != null ? `${a.id_aviso}.${a.id_sequencia ?? 1}` : null;
    if (!lvl || lvl.level < 2 || !a.descricao || !start || !geom || !c || !key || seen.has(key) || a.encerrado || (end && Date.parse(end) < ctx.now)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const ev = inmetEvent(a.descricao);
    const states = list(a.estados);
    const where = states.length > 3 ? `${states.slice(0, 3).join(", ")} and ${states.length - 3} more states` : states.join(", ") || "Brazil";
    const muni = list(a.municipios).length;
    const risks = (a.riscos ?? []).map((r) => plainText(r, 300)).filter(Boolean).join(" ");
    const title = `${ev.en} warning (${lvl.colour}) — ${where}, Brazil`;
    const seq = a.id_sequencia ?? 1;
    candidates.push({
      type: ev.type,
      subtype: ev.subtype,
      title: clip(title, 300),
      summary: clip(
        `INMET (Brazil's national weather service) issued ${lvl.colour === "orange" ? "an" : "a"} ${lvl.colour}-level warning for ${a.descricao} ("${a.severidade}", ${lvl.en}) for ${where}` +
          `${muni ? ` (${muni} municipalities)` : ""}, from ${start.slice(0, 16).replace("T", " ")} UTC${end ? ` to ${end.slice(0, 16).replace("T", " ")} UTC` : ""}.` +
          (risks ? ` Risks stated: ${risks}` : ""),
        1990,
      ),
      description: a.mesorregioes ? clip(`Areas: ${list(a.mesorregioes).join(", ")}.`, 2000) : null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: "region",
      geometry: simplifyArea(geom as NonNullable<NwsAlertFeature["geometry"]>),
      locationName: `${where}, Brazil`,
      country: "BR",
      timestamp: start,
      resolvedAt: end,
      metrics: { warning_level: lvl.level, warning_colour: lvl.colour, severity_pt: a.severidade ?? null, municipalities: muni || null },
      entities: [{ type: "ORGANIZATION", name: "Instituto Nacional de Meteorologia", code: "INMET" }],
      supersedes: seq > 1 ? [`inmet-alerts:${a.id_aviso}.${seq - 1}`] : [],
      source: {
        id: `inmet-alerts:${key}`,
        dataSourceId: "inmet-alerts",
        externalId: key,
        sourceName: "INMET — Instituto Nacional de Meteorologia (Brazil)",
        sourceUrl: a.id ? `https://avisos.inmet.gov.br/${a.id}` : "https://avisos.inmet.gov.br/",
        title: `Aviso de ${a.descricao}. Severidade Grau: ${a.severidade}`,
        titleIsDerived: false,
        publishedAt: null,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Brazil's national meteorological service (federal government)" },
      },
      rawData: { id: a.id, id_aviso: a.id_aviso, id_sequencia: a.id_sequencia, codigo: a.codigo, inicio: a.inicio, fim: a.fim, severidade: a.severidade, estados: a.estados },
    });
  }
  return { candidates, skipped };
}

export const inmetAlertsConnector: DataSourceConnector<InmetRaw> = {
  id: "inmet-alerts",
  name: "Brazil weather warnings (INMET)",
  description: "Orange (Perigo) and red (Grande Perigo) weather warnings from Brazil's INMET — storms, heavy rain, gales, heat, cold — with warning-area polygons.",
  homepage: "https://avisos.inmet.gov.br/",
  attribution: "INMET — Instituto Nacional de Meteorologia; reproduction permitted with the source cited",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER", "FLOOD"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 45_000,
  mode: "live",
  fetch: fetchInmet,
  parse: parseInmet,
};
