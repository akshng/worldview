/** Subset of CAMEO event codes → readable labels and WorldView categories. */
import type { EventCategory } from "@/types/events";

export const CAMEO_BASE: Record<string, string> = {
  "130": "Threat", "131": "Non-force threat", "132": "Threat of sanctions", "133": "Threat of political dissent",
  "134": "Threat to halt negotiations", "135": "Threat to halt mediation", "136": "Threat to halt international involvement",
  "137": "Threat of repression", "138": "Threat of military force", "139": "Ultimatum",
  "140": "Protest", "141": "Demonstration or rally", "142": "Hunger strike", "143": "Strike or boycott",
  "144": "Blockade or obstruction", "145": "Violent protest or riot",
  "150": "Military or police posture", "151": "Police alert raised", "152": "Military alert raised",
  "153": "Police mobilization", "154": "Military mobilization", "155": "Cyber forces mobilized",
  "160": "Relations reduced", "161": "Diplomatic relations reduced or broken", "162": "Aid reduced or stopped",
  "163": "Embargo, boycott or sanctions", "164": "Negotiations halted", "165": "Mediation halted",
  "166": "Expulsion of inspectors or peacekeepers",
  "170": "Coercion", "171": "Property seized or damaged", "172": "Administrative sanctions",
  "173": "Arrest or detention", "174": "Expulsion or deportation", "175": "Violent repression", "176": "Cyber attack",
  "180": "Assault", "181": "Abduction or hostage-taking", "182": "Physical assault", "183": "Bombing",
  "184": "Use of human shield", "185": "Assassination attempt", "186": "Assassination",
  "190": "Armed clash", "191": "Blockade", "192": "Occupation of territory", "193": "Small-arms fighting",
  "194": "Artillery or tank fighting", "195": "Aerial attack", "196": "Ceasefire violation",
  "200": "Mass violence", "201": "Mass expulsion", "202": "Mass killing", "203": "Ethnic cleansing",
  "204": "Use of weapons of mass destruction",
};

export const CAMEO_ROOT: Record<string, string> = {
  "01": "Public statement", "02": "Appeal", "03": "Intent to cooperate", "04": "Consultation or meeting",
  "05": "Diplomatic cooperation", "06": "Material cooperation", "07": "Aid provided", "08": "Concession",
  "09": "Investigation", "10": "Demand", "11": "Criticism", "12": "Rejection", "13": "Threat", "14": "Protest",
  "15": "Force posture", "16": "Reduced relations", "17": "Coercion", "18": "Assault", "19": "Armed conflict",
  "20": "Mass violence",
};

export interface CameoRule {
  category: EventCategory;
  /** Minimum NumArticles for the record to be kept */
  minArticles: number;
  /** Higher = more significant; used to pick one event per article */
  priority: number;
}

export function cameoRule(root: string, base: string): CameoRule | null {
  if (base === "155" || base === "176") return { category: "TECHNOLOGY", minArticles: 2, priority: 6 };
  switch (root) {
    case "20":
      return { category: "CONFLICT", minArticles: 1, priority: 10 };
    case "19":
      return { category: "CONFLICT", minArticles: 1, priority: 9 };
    case "18":
      return { category: "CONFLICT", minArticles: 1, priority: 8 };
    case "15":
      return { category: "CONFLICT", minArticles: 3, priority: 6 };
    case "14":
      return { category: "PROTEST", minArticles: 1, priority: 7 };
    case "17":
      return { category: "POLITICS", minArticles: 3, priority: 5 };
    case "16":
    case "13":
      return { category: "POLITICS", minArticles: 4, priority: 4 };
    default:
      // Cooperation/statements are high-volume and low-signal; keep only widely covered ones.
      return { category: "POLITICS", minArticles: 25, priority: 1 };
  }
}

export function cameoLabel(base: string, root: string): string {
  return CAMEO_BASE[base] ?? CAMEO_ROOT[root] ?? "Event";
}

const ARMED = /MIL|REB|INS|UAF|SEP|SPY/;
const CRIME = /COP|CRM|JUD/;

/**
 * GDELT codes much routine crime reporting as assault/fighting. Use actor type
 * codes to keep CONFLICT for armed actors and route police/criminal/judicial
 * stories to NEWS ("crime / public safety").
 */
export function refineCategory(
  rule: CameoRule,
  root: string,
  actorCodes: string[],
  actorCountries: [string, string] = ["", ""],
): CameoRule & { subtype?: string } {
  const codes = actorCodes.filter(Boolean).join(" ");
  const armed = ARMED.test(codes);
  const crime = CRIME.test(codes) && !armed;
  // Two different countries' actors = interstate interaction.
  const interstate = !!actorCountries[0] && !!actorCountries[1] && actorCountries[0] !== actorCountries[1];
  const asCrime = { ...rule, category: "NEWS" as const, priority: 3, subtype: "crime / public safety" };
  if (root === "18") return armed ? rule : asCrime;
  // Violence coded without armed or interstate actors is usually crime reporting.
  if ((root === "19" || root === "20") && (crime || (!armed && !interstate))) return asCrime;
  if (root === "17" && crime) return asCrime;
  return rule;
}
