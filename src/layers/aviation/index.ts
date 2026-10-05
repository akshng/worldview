import { httpGet } from "@/data-sources/types";
import type { LiveLayerProvider } from "../types";
import { parseOpenSky } from "./parser";
import type { AviationData, OpenSkyResponse } from "./types";

const URL_ALL = "https://opensky-network.org/api/states/all";

/**
 * Anonymous OpenSky access: 400 API credits/day; a global snapshot costs 4.
 * A 20-minute TTL keeps continuous viewing under ~290 credits/day.
 * Optional OPENSKY_CLIENT_ID/SECRET raise limits (OAuth client credentials).
 */
export const aviationLayer: LiveLayerProvider<AviationData> = {
  id: "aviation",
  name: "Aircraft (OpenSky Network)",
  description: "Live positions of aircraft broadcasting ADS-B/Mode S, from the OpenSky Network community receiver network.",
  homepage: "https://opensky-network.org/",
  attribution: "The OpenSky Network, https://opensky-network.org",
  ttlMs: 20 * 60_000,
  async load(ctx) {
    const headers: Record<string, string> = {};
    const id = ctx.env.OPENSKY_CLIENT_ID, secret = ctx.env.OPENSKY_CLIENT_SECRET;
    if (id && secret) {
      const tok = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
        method: "POST",
        signal: ctx.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      });
      if (tok.ok) headers.Authorization = `Bearer ${(await tok.json()).access_token}`;
    }
    const res = await httpGet(URL_ALL, ctx, { headers });
    const raw = (await res.json()) as OpenSkyResponse;
    const data = parseOpenSky(raw);
    return {
      layerId: "aviation",
      observedAt: new Date(raw.time * 1000).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: data.rows.length,
      data,
      attribution: this.attribution,
      notes: [
        `Snapshot refreshed at most every ${Math.round(this.ttlMs / 60_000)} minutes to respect OpenSky's anonymous quota.`,
        "Coverage depends on volunteer receivers: dense over North America and Europe, sparse over oceans.",
      ],
    };
  },
};
