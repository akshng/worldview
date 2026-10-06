export interface Outlet {
  id: string;
  name: string;
  url: string;
  homepage: string;
  /** Home country (ISO2) for a national outlet: its towns and provinces are recognised in headlines. */
  home?: string;
  /** Region the outlet mainly covers, for documentation and balance checks. */
  region: "global" | "asia" | "middle-east" | "africa" | "latin-america" | "europe" | "americas" | "oceania";
}
export interface RssItem {
  title: string;
  link: string;
  description: string;
  published: string | null;
}
export interface NewsRssRaw {
  feeds: Array<{ outlet: Outlet; items: RssItem[] }>;
}
