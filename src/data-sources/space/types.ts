/** Launch Library 2 (The Space Devs) — https://ll.thespacedevs.com/docs/ (free tier: 15 requests/hour) */
export interface Ll2Launch {
  id: string;
  url: string;
  name: string;
  status: { id: number; name: string; abbrev: string; description: string } | null;
  last_updated: string;
  net: string;
  net_precision?: { name: string; abbrev: string } | null;
  window_start: string;
  window_end: string;
  failreason?: string | null;
  launch_service_provider: { name: string; type?: { name: string } } | null;
  rocket: { configuration: { name: string; full_name: string } } | null;
  mission: { name: string; type: string; description: string | null; orbit: { name: string } | null } | null;
  pad: {
    name: string;
    latitude: number | string;
    longitude: number | string;
    country?: { alpha_2_code: string; name: string } | null;
    location?: { name: string } | null;
  } | null;
  webcast_live?: boolean;
}

export interface Ll2Page {
  count: number;
  results: Ll2Launch[];
}

export interface SpaceRaw {
  upcoming: Ll2Launch[];
  previous: Ll2Launch[];
}
