import { httpGet, type FetchContext } from "../types";
import type { WhoDonResponse } from "./types";

export async function fetchWho(ctx: FetchContext): Promise<WhoDonResponse> {
  const url = "https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDate%20desc&$top=25&$select=Id,Title,OverrideTitle,UrlName,DonId,PublicationDate,LastModified,Summary,Overview";
  return (await (await httpGet(url, ctx)).json()) as WhoDonResponse;
}
