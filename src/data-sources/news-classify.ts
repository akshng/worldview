/**
 * Headline context rules shared by the news classifiers (news RSS headlines and
 * GDELT GKG articles). Keyword lists alone file "The war on survival…" or "Ruto turns
 * tour into Gachagua attack" as armed conflict; these rules look at the context:
 *
 *  - figurative or non-violent uses are removed first ("war on poverty", "price war",
 *    "heart attack", "legal battle", "strike a deal", "box-office bomb"…);
 *  - unambiguous armed-conflict vocabulary (airstrike, shelling, troops, militants…)
 *    decides CONFLICT;
 *  - "war" alone counts unless it is background ("amid the war") or the headline is
 *    about elections/politics;
 *  - attack/strike/blast words need violent context and no political-rhetoric cue;
 *  - killings, shootings and stabbings without armed-conflict actors are crime.
 *
 * Measured against the labelled headline fixtures in tests/fixtures/headlines.ts.
 */

export type ConflictSignal =
  | { kind: "conflict"; subtype: "armed conflict" | "terrorism" | "military posture"; /** strong = unambiguous vocabulary; weak = attack/strike/war words in violent context */ strength: "strong" | "weak" }
  | { kind: "crime" }
  | { kind: "none" };

/** Phrases that look like conflict vocabulary but are not (removed before matching). */
const FIGURATIVE: RegExp[] = [
  /\bwars? on (?!terror\b|terrorism\b|isis\b|hamas\b|hezbollah\b|gangs?\b|cartels?\b|(?:the )?(?:gaza|ukraine|iran|israel|russia|lebanon|syria|yemen|sudan)\b)[\p{L}'’-]+/giu,
  /\b(?:drug|antisemitism|woke|meme|price|trade|tariff|culture|cultural|bidding|talent|turf|class|currency|chip|streaming|subsidy|tech|console|format|legal|ratings|gender|budget|fare|propaganda|flame|console|patent|search|cola|smartphone|ai)\s+wars?\b/gi,
  /\bwars? of (?:words|attrition over|nerves)\b/gi,
  /\bwar (?:chest|room|games?|paint|cry|horse|of the roses)\b/gi,
  /\bstar wars\b|\bcold war\b|\bworld war (?:i{1,2}|one|two|1|2)\b|\bww(?:i{1,2}|1|2)\b/gi,
  /\b(?:post-?war|pre-?war|inter-?war)\b/gi,
  /\b(?:trade|tariff|price|pay) truces?\b/gi,
  /\b(?:cold|arctic|polar|icy|winter|chilly) blasts?\b/gi,
  /\b(?:heart|panic|asthma|anxiety|shark|dog|bear|snake|crocodile|bee|wasp|cyber|ransomware|phishing|hacker|ddos|acid)\s+attacks?\b/gi,
  /\battacks? on (?:democracy|the press|press freedom|free speech|freedom|the judiciary|judges|the constitution|(?:women|voting|human) rights|science|the media|the rule of law|the economy)\b/gi,
  /\b(?:legal|court|courtroom|custody|uphill|political|ratings|box[- ]office|title|relegation|electoral|leadership|policy|budget|lawsuit|copyright|patent|takeover|boardroom|proxy|tax|bidding|regulatory|trademark|bitter|long)\s+(?:battles?|fights?)\b/gi,
  /\bbattl(?:e|es|ing|ed) (?:with|against) (?:cancer|illness|addiction|obesity|depression|dementia|inflation|the bulge|leukaemia|leukemia|disease|wildfires?|fires?|blazes?|floods?)\b/gi,
  /\b(?:hunger|general|labou?r|rail|railway|teachers?['’]?|nurses?['’]?|doctors?['’]?|workers?['’]?|dockworkers?['’]?|union|pilots?['’]?|staff|national|transport|port|dock|rent|climate|school|student|tube|bus|postal|airport|drivers?['’]?|miners?['’]?)\s+strikes?\b/gi,
  /\b(?:go(?:es|ing)?|went|are|were|be|been|is) on strike\b|\bstrike action\b|\bstrike ballot\b/gi,
  /\bstrikes? (?:a |an )?(?:deal|agreement|balance|chord|gold|oil|a pose|down|out|it rich|lucky)\b|\bstruck (?:a |an )?(?:deal|agreement|down|gold|off)\b/gi,
  /\blightning strikes?\b|\bstruck by lightning\b/gi,
  /\b(?:late|stunning|wonder|first[- ]half|second[- ]half|injury[- ]time|last[- ]gasp)\s+strikes?\b|\bstrikers?\b/gi,
  /\b(?:box[- ]office|photo)\s?bomb(?:s|ed)?\b|\bbombshells?\b|\bbomb cyclone\b|\bbombs? at the box office\b|\bf-bombs?\b/gi,
  /\bshooting (?:stars?|guard|range|script|schedule|wraps|begins|starts|location)\b|\b(?:film|photo)\s?shoots?\b|\b(?:begins|starts|wraps|finishes|resumes) (?:shooting|filming)\b/gi,
  /\bkill(?:s|ed)? (?:off )?(?:the |a |his |her |their )?(?:bill|deal|plan|proposal|project|merger|rule|policy|app|feature|jobs|momentum|vibe|mood|time|the buzz)\b|\bkiller (?:app|feature|deal)\b/gi,
  /\bcharm offensive\b|\boffensive (?:remarks?|comments?|tweets?|posts?|language|jokes?|chants?|content|line|coordinator|lineman|rebounds?|play)\b/gi,
  /\bsalvation army\b|\barmy of (?:volunteers|fans|supporters|followers|helpers|lawyers)\b|\barmy-navy\b|\btroll army\b|\bdad'?s army\b/gi,
  /\b(?:pitch|home|privacy|tourist|locust|insect|species)\s+invasions?\b|\binvasion of (?:privacy|the pitch)\b/gi,
  /\bdrones? (?:delivery|deliveries|shows?|light shows?|photography|footage|racing|pilots?)\b/gi,
  /\bfrontline (?:workers?|staff|nurses?|doctors?|health|services?|care|police)\b/gi,
  /\b(?:tory|labour|backbench|party|conservative|democratic|republican|gop|mps?|senate)\s+rebels?\b|\brebels? (?:mps|lawmakers|senators|councillors)\b|\brebel (?:wilson|alliance|yell|heart)\b/gi,
  /\bcrosshairs\b|\bunder fire (?:for|over|after|from)\b|\bin the firing line\b|\bfire(?:s|d)? back at\b/gi,
  /\bblast(?:s|ed)? (?:critics|rivals?|opponents?|the government|government|decision|ruling|plan|report|claims?)\b|\bblast from the past\b/gi,
  /\b(?:dance|rap|pillow|food|snowball|water|pie|tomato)\s+(?:fights?|battles?|wars?)\b/gi,
  /\bbattle (?:of the bands|royale|for (?:the )?(?:title|top spot|survival in|custody))\b/gi,
];

/** Unambiguous armed-conflict / terrorism vocabulary. */
const TERROR = /\b(?:terror(?:ism|ists?)?(?: attacks?)?|suicide (?:bomb\w*|attacks?)|car bomb\w*|jihad(?:ists?|i)?|extremist (?:attack|group|militants?)|ieds?|assassinat\w+)\b/i;
const ARMED = /\b(?:border (?:clash\w*|shooting|skirmish\w*|fire)|(?:heavy|fierce|intense|renewed) fighting|drones? (?:target\w*|hit|hits|struck|downed)|air ?strikes?|drone strikes?|missile (?:strikes?|attacks?)|rocket (?:fire|attacks?|barrage)|shell(?:ing|ed|s)|artillery|bombard\w*|bombing|bombed|troops|soldiers?|militants?|insurgen\w+|rebels?|militias?|paramilitar\w+|guerrill\w+|gunmen|jihadists?|front ?lines?|invasion|invad\w+|ceasefire|truce|armed forces|armed groups?|army|military|navy|naval|warships?|warplanes?|fighter jets?|missiles?|rockets?|hezbollah|hamas|houthis?|taliban|al-shabaab|boko haram|isis|islamic state|wagner group|idf|rapid support forces|rsf (?:fighters|forces|militia|paramilitar\w+|attack\w*|seiz\w+|shell\w*|drones?)|nato|gun ?battles?|gunfights?|firefights?|war crimes?|civil war|occupied|occupation forces|counter-?offensive|offensive|hostages?)\b/i;
/** Military posture without violence: exercises, deployments, arms. */
const POSTURE = /\b(?:military (?:drills?|exercises?|build-?up|aid|spending)|naval (?:drills?|exercises?|patrols?)|war ?games|troops? (?:deploy\w*|build-?up)|deploy\w* (?:troops|warships?|soldiers)|arms (?:deals?|sales?|race|exports?|imports?)|warships?|nuclear (?:weapons?|warheads?|tests?)|missile (?:tests?|launch\w*|defen[cs]e)|(?:anti-)?satellite attacks?|defen[cs]e (?:pact|ministers?|ministry|spending|budget|forces))\b/i;
const WAR = /\bwars?\b|\bwarring\b/i;
/** Space launches: "rocket" is not a weapon here. */
const SPACE = /\b(?:space|spacex|nasa|isro|esa|suborbital|orbit\w*|lunar|moon|satellites?|payload|long march|falcon|starship|ariane|launch pad|spaceport)\b/i;
/** Parties to current armed conflicts: an attack/strike word next to them is military. */
const ACTORS = /\b(?:russia|russian|ukraine|ukrainian|kyiv|moscow|israel|israeli|gaza|west bank|hamas|hezbollah|iran|iranian|tehran|lebanon|lebanese|syria|syrian|yemen|houthis?|sudan|sudanese|darfur|khartoum|somalia|al-shabaab|myanmar|junta|sahel|mali|burkina|niger|congo|m23|kashmir|taliban|pakistan army|idf)\b/i;
const WEAK = /\b(?:attacks?|attacked|attacking|strikes?|struck|bomb(?:s)?|blasts?|explosions?|drones?|clash(?:es|ed)?|raids?|fighting|gunfire|ambush(?:ed)?|battles?|shot down|killed in (?:an? )?(?:strike|attack|raid|blast))\b/gi;
const VIOLENT = /\b(?:kill(?:s|ed|ing)?|dead|deaths?|died|wounded|injur(?:ed|ies|es)|casualt\w+|civilians?|massacre\w*|abduct\w*|kidnapp?\w*|toll)\b/i;
/** Specific crime vocabulary. */
const CRIME = /\b(?:murder\w*|stabb?\w*|knife|machete|gunman|shooter|mass shooting|shootings?|shot dead|homicide|robbery|robbers?|burglar\w*|rape\w*|police|cops?|arrest\w*|suspects?|charged|sentenced|jailed|convicted|trial|gang|bomb threats?|acid|carjack\w*)\b/i;
/** A killing of/by private individuals ("Man kills 4-year-old…"). */
const PERSONS = /\b(?:man|woman|men|women|teen(?:ager)?s?|boy|girl|toddler|baby|child|mother|father|wife|husband|son|daughter|student|neighbou?r|\d+-year-old|organs?|family)\b/i;
/** Politics/rhetoric cues: an "attack" here is verbal; "war" here is a campaign issue. */
const RHETORIC = /\b(?:tour|campaign|rally|rallies|speech|critics?|opposition|rival|rivals|slams?|lashes out|jibes?|swipe|remarks?|verbal|mps|lawmakers|senators?|ads?|tweets?|debate|manifesto|congratulat\w+)\b/i;
const POLITICS = /\b(?:votes?|voters?|elections?|electoral|midterms?|polls?|campaign|republicans?|democrats?|parliament|congress|senate|budget|approval|veto|bills?|party|lawmakers|referendum|primary)\b/i;
const BACKGROUND_WAR = /\b(?:amid|during|after|since|before|despite|throughout|because of|price[’'"‘]* of|cost of|toll of|scars of|legacy of|survivors? of|veterans? of|refugees? from) (?:the |a |two years of |years of )?(?:[\p{L}-]+ )?wars?\b|\bwar-?(?:torn|hit|ravaged|weary|scarred)\b|\bwar (?:veterans?|widows?|orphans?|refugees?|memorial|museum|anniversary|graves?|dead|criminals? trial)\b/iu;
const SPORTS = /\b(?:vs?\.|versus|derby|semi-?finals?|quarter-?finals?|cup final|kick-?off|top-of-table|premier league|champions league|la liga|serie a|bundesliga|nba|nfl|nhl|mlb|ipl|innings|wickets?|playoffs?|grand slam|tennis|cricket|football|soccer|rugby|golf|f1|grand prix|olympics?|world cup|midfielder|striker|overtime|late (?:win|winner|goal|equali[sz]er)|\d+-\d+ (?:win|victory|defeat|loss))\b|\b\d+-\d+$/i;

/** Headline with figurative / non-violent conflict phrases blanked out. */
export function withoutFigurative(title: string): string {
  let t = title;
  for (const re of FIGURATIVE) t = t.replace(re, " ¶ ");
  return t;
}

export function conflictSignal(title: string): ConflictSignal {
  let t = withoutFigurative(title);
  if (SPACE.test(t)) t = t.replace(/\brockets?\b/gi, " ¶ ");
  const sports = SPORTS.test(title);
  if (TERROR.test(t)) return { kind: "conflict", subtype: "terrorism", strength: "strong" };
  if (ARMED.test(t) && !sports) return { kind: "conflict", subtype: POSTURE.test(t) && !VIOLENT.test(t) ? "military posture" : "armed conflict", strength: "strong" };
  if (POSTURE.test(t)) return { kind: "conflict", subtype: "military posture", strength: "strong" };
  const weak = new Set((t.match(WEAK) ?? []).map((w) => w.toLowerCase().replace(/(?:es|s|ed|ing)$/, "")));
  const violent = VIOLENT.test(t);
  const crime = CRIME.test(t);
  if (WAR.test(t) && !sports && !BACKGROUND_WAR.test(t) && !(POLITICS.test(t) && !weak.size && !violent)) {
    return { kind: "conflict", subtype: "armed conflict", strength: "weak" };
  }
  if (weak.size && !sports) {
    if (RHETORIC.test(t) && !violent) return { kind: "none" };
    if (ACTORS.test(t)) return { kind: "conflict", subtype: "armed conflict", strength: "weak" };
    if (crime) return { kind: "crime" };
    if (violent || weak.size >= 2) return { kind: "conflict", subtype: "armed conflict", strength: "weak" };
    // "Israeli strikes on Gaza", "Russian drone attack on Kyiv": a state/armed actor or a target place.
    if (/\b(?:on|in|at|against|near|across|over|into|hit|hits) [A-Z][\p{L}-]+/u.test(t) || /^(?:[A-Z][\p{L}-]+(?:'s|’s)?|U\.?S\.?) (?:air|drone|missile|navy|army)?\s?(?:strikes?|attacks?|raids?|bomb\w*)/u.test(t)) {
      return { kind: "conflict", subtype: "armed conflict", strength: "weak" };
    }
    return { kind: "none" };
  }
  if (/\b(?:murder\w*|stabb?\w*|shootings?|shot dead|gunman|homicide|mass shooting)\b/i.test(t) || (violent && crime)) return { kind: "crime" };
  // "Israeli fire kills father and son in Gaza": deaths caused by a party to a conflict.
  if (violent && ACTORS.test(t) && /\b(?:fire|forces|shot|shooting|raid|strike)\b/i.test(t)) return { kind: "conflict", subtype: "armed conflict", strength: "weak" };
  if (violent && PERSONS.test(t)) return { kind: "crime" };
  return { kind: "none" };
}

/** Labour strikes ("Nurses strike over pay", "Rail workers go on strike"). */
export const LABOUR_STRIKE = /\b(?:hunger|general|labou?r|rail|railway|teachers?['’]?|nurses?['’]?|doctors?['’]?|workers?['’]?|dockworkers?['’]?|union|pilots?['’]?|staff|national|transport|port|dock|tube|bus|postal|airport|drivers?['’]?|miners?['’]?)\s+strikes?\b|\bwalk(?:s|ed)? out over\b|\b(?:go(?:es|ing)?|went|are|were|be|been) on strike\b|\bstrike action\b|\b(?:workers|nurses|doctors|teachers|pilots|drivers|staff|employees|miners|dockers|unions?)\s+(?:to\s+)?(?:strike|walk out|stage (?:a )?(?:walkout|strike))\b|\bwalkouts?\b/i;

/** Protest wording that is not about a protest ("protest vote", "crackdown on fraud", "demonstrates new robot"). */
const PROTEST_FIGURATIVE = /\bprotest vote\b|\bunder protest\b|\bprotestants?\b|\bcrackdown on (?!protest\w*|demonstrat\w*|dissent\w*|opposition|activists?|dissidents?|journalists?|students?)[\p{L}-]+|\bdemonstrat(?:es|ed|ing) (?:that|how|its|their|his|her|a|an|the|new)\b|\bdemonstration (?:of|flight|project|plant|model|video)\b|\briot of (?:colou?rs?|flavou?rs?)\b|\bmarch(?:es|ed)? (?:on|towards?|toward) (?:the )?(?:title|record|playoffs?|final)\b/giu;
export function withoutFigurativeProtest(title: string): string {
  return title.replace(PROTEST_FIGURATIVE, " ¶ ");
}

/**
 * Hazard words used figuratively ("landslide victory", "political earthquake",
 * "storm of criticism", "flood of orders", "trophy drought").
 */
const DISASTER_FIGURATIVE = /\blandslide (?:victory|win|wins|election|vote|majority|defeat|re-?election)\b|\bwins? (?:in |by )?(?:a )?landslide\b|\bpolitical (?:earthquake|tsunami|storm|firestorm)\b|\b(?:storm|tsunami|flood|avalanche|eruption|deluge|torrent|hurricane|whirlwind) of (?:criticism|protest|complaints?|orders|applications|interest|support|money|cash|investment|imports|migrants|refugees|tweets|emails|data|violence|anger|outrage|praise|questions|demand|requests|lawsuits|cases|goals|votes|misinformation)\b|\b(?:by|up a|perfect|brewing|weather the|weathers the|weathering the|calm before the|eye of the) storms?\b|\bfirestorms?\b|\bstorm(?:s|ed|ing)? (?:out|off|into|past|to victory|back|(?:the |a )?(?:parliament|capitol|building|palace|stage|offices?|embassy|court|airport|field|pitch|streets|charts))\b|\b(?:trophy|title|goal|scoring|win|winless|medal|playoff|silverware)\s+drought\b|\bflooded (?:with|by) (?:calls|orders|applications|messages|complaints|requests)\b|\bfloods? (?:the|social media|the market|in to)\b|\bvolcanic (?:rage|anger|temper)\b|\bbrainstorm\w*\b|\bheat (?:is on|of the moment|map)\b|\b(?:carolina|miami|cane) hurricanes\b|\bstorm (?:chasers?|troopers?)\b/gi;
export function withoutFigurativeDisaster(title: string): string {
  return title.replace(DISASTER_FIGURATIVE, " ¶ ");
}

/** Accidents filed as disaster news (Wikipedia's "Disasters and accidents"). */
export const ACCIDENT = /\b(?:(?:mine|building|bridge|dam|stadium|roof|tunnel|wall|scaffold\w*|crane) collapses?d?|collapse of (?:a |the )?(?:mine|building|bridge|dam)|(?:train|rail) (?:derail\w*|crash|collision)|derail\w+|(?:gas|chemical|factory|plant|refinery|boiler|mine|fireworks?|pipeline) (?:explosion|blast|fire|leak)|explosion at (?:a |the )?(?:factory|plant|refinery|mine|warehouse|chemical)|(?:bus|ferry|boat|coach|truck|minibus) (?:crash|accident|plunges|capsizes|overturns|sinks)|(?:ferry|boat|ship) capsiz\w+|stampede|building fire|(?<!\b(?:israeli|russian|ukrainian|army|troops|tank|sniper|gun|enemy|artillery|rocket|mortar|forces) )fire (?:kills|guts|destroys|engulfs))\b/i;
