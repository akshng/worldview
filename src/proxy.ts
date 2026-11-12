/**
 * Request guard for the local API (Next.js 16 "proxy", formerly middleware).
 *
 * WorldView runs on the owner's machine with no login, so two things keep other
 * parties out of /api:
 *   1. Host must be a loopback name (127.0.0.1, localhost, [::1]): blocks DNS-rebinding
 *      pages and other devices on the network.
 *   2. Browsers label every request with Sec-Fetch-Site. Anything "cross-site" or
 *      "same-site" (another website, or another localhost port) is refused, so a page
 *      you visit can't post to your Discord, start AI jobs or change your watchlist.
 *      The app itself sends "same-origin"; scripts and curl send none (allowed).
 */
import { NextResponse, type NextRequest } from "next/server";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

export function guardDecision(h: { host: string | null; secFetchSite: string | null; origin: string | null }): string | null {
  if (!h.host || !LOOPBACK_HOST.test(h.host)) return "This API only answers on this computer (127.0.0.1 / localhost).";
  if (h.secFetchSite && h.secFetchSite !== "same-origin" && h.secFetchSite !== "none") return "Cross-site requests to WorldView are blocked.";
  if (!h.secFetchSite && h.origin && h.origin !== "null" && !LOOPBACK_ORIGIN.test(h.origin)) return "Cross-origin requests to WorldView are blocked.";
  if (h.origin === "null") return "Requests from opaque origins are blocked.";
  return null;
}

export function proxy(req: NextRequest) {
  const reason = guardDecision({ host: req.headers.get("host"), secFetchSite: req.headers.get("sec-fetch-site"), origin: req.headers.get("origin") });
  if (reason) return NextResponse.json({ error: reason }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*", "/_next/image"] };
