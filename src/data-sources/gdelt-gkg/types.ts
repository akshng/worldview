/**
 * GDELT 2.0 Global Knowledge Graph (GKG) — one row per news article, with the
 * article's real title, themes, people, organisations, tone and geocoded
 * mentions. Codebook: http://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf
 */
export interface GkgLocation {
  type: number; // 1 country, 2 US state, 3 US city, 4 world city, 5 world ADM1
  name: string;
  fips: string;
  lat: number;
  lon: number;
  mentions: number;
}

export interface GkgArticle {
  date: string; // YYYYMMDDHHMMSS
  source: string; // SourceCommonName
  url: string;
  title: string | null;
  themes: string[];
  locations: GkgLocation[];
  persons: string[];
  organizations: string[];
  tone: number | null;
}

export interface GkgRaw {
  files: Array<{ url: string; articles: GkgArticle[] }>;
}
