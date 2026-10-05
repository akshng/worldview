export interface Outlet {
  id: string;
  name: string;
  url: string;
  homepage: string;
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
