/**
 * Turns a research packet into a likely cause for the move and a suggested take,
 * with plain rules (the small on-device model explains a verdict well but picks
 * one poorly). Not a prediction: just how the evidence lines up.
 */

const DOWN = /\b(falls?|fell|drops?|dropped|slides?|slid|sinks?|sank|tumbles?|tumbled|plunges?|plunged|slumps?|declines?|lower|down \d|sell-?off|weighs?|brace)\b/i;
const BAD_COMPANY = /\b(miss(es|ed)?|cuts? (guidance|outlook|forecast)|lowers? (guidance|outlook)|warns?|warning|downgrade[sd]?|probe|investigation|lawsuit|sued|recall|fraud|bankrupt\w*|delist\w*|ceo (exits?|resigns?|departs?)|guidance cut|disappoint\w*)\b/i;
const SECTOR = /\b(sector|industry|peers|refiners?|chipmakers?|banks|oil|crude|rates|yields|tariffs?|rotation|market sell-?off|broad)\b/i;
const GOOD = /\b(upgrade[sd]?|overweight|outperform|buy rating|raises? (guidance|outlook)|beats?|record|initiat\w+ .*(buy|overweight|outperform))\b/i;

export interface TakeInput {
  headlines: string[];
  earningsRecent: string | null;
  earningsUpcoming: string | null;
  growth: number | null; // revenue or profit change vs a year earlier, %
  insiderBuyers: number;
  insiderBuyValue: number;
}

export interface Take {
  likelyCause: string;
  take: "Worth a closer look" | "Wait" | "Pass";
  reason: string;
}

export function suggestTake(x: TakeInput): Take {
  const moveHeadline = x.headlines.find((h) => DOWN.test(h) || BAD_COMPANY.test(h));
  const bad = x.headlines.find((h) => BAD_COMPANY.test(h));
  const good = x.headlines.find((h) => GOOD.test(h));
  const sector = moveHeadline && SECTOR.test(moveHeadline) && !BAD_COMPANY.test(moveHeadline);
  const likelyCause = bad
    ? `Company-specific bad news: "${bad}"`
    : x.earningsRecent
      ? `${x.earningsRecent} The drop may be a delayed reaction to that report${moveHeadline ? `; headline: "${moveHeadline}"` : ""}.`
      : moveHeadline
        ? `${sector ? "Looks industry-wide" : "Reported cause"}: "${moveHeadline}"`
        : "No headline, filing or earnings report explains the move.";
  const growing = x.growth !== null && x.growth > 5;
  const shrinking = x.growth !== null && x.growth < -5;
  const insiderConviction = x.insiderBuyers >= 2 || x.insiderBuyValue >= 250_000;

  if (x.earningsUpcoming) return { likelyCause, take: "Wait", reason: `${x.earningsUpcoming} Earnings can move it sharply either way, so it is worth waiting for the report.` };
  if (bad && !growing) return { likelyCause, take: "Pass", reason: "The drop has a company-specific cause and the business isn't growing to offset it." };
  if (shrinking && !insiderConviction) return { likelyCause, take: "Pass", reason: `The business is shrinking (${x.growth!.toFixed(0)}% vs a year earlier).` };
  if (growing && (sector || good || insiderConviction || (!bad && moveHeadline)))
    return {
      likelyCause,
      take: "Worth a closer look",
      reason: `The business is growing (+${x.growth!.toFixed(0)}% vs a year earlier)${insiderConviction ? " and insiders have been buying" : ""}${good ? `, and there's a positive analyst or company signal ("${good}")` : ""}${sector ? "; the drop looks industry-wide rather than about this company" : ""}.`,
    };
  if (!moveHeadline && !bad && !x.earningsRecent) return { likelyCause, take: "Wait", reason: "Nothing explains the drop yet; buying an unexplained fall is a gamble." };
  return { likelyCause, take: "Wait", reason: growing ? "The business is growing but the drop's cause isn't clearly temporary." : "Mixed evidence: no clear growth to lean on." };
}
