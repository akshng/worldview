import "server-only";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { env } from "@/lib/env";

export function json<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

export function badRequest(error: ZodError | string) {
  const details =
    typeof error === "string"
      ? undefined
      : error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return json({ error: typeof error === "string" ? error : "Invalid request", details }, { status: 400 });
}

export function notFound(what = "Not found") {
  return json({ error: what }, { status: 404 });
}

export function serverError(err: unknown) {
  console.error("[api]", err);
  return json({ error: "Internal server error" }, { status: 500 });
}

const GZIP_MIN_BYTES = 16_000;

/**
 * Gzip large JSON responses when the client accepts it. Route-handler responses
 * aren't compressed by Next.js itself, and the event and camera lists are
 * several MB of highly compressible JSON.
 */
export async function maybeCompress(req: unknown, res: Response): Promise<Response> {
  if (!(req instanceof Request) || !res.body || res.headers.get("content-encoding")) return res;
  if (!/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) return res;
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const body = Buffer.from(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.append("Vary", "Accept-Encoding");
  if (body.length < GZIP_MIN_BYTES) return new Response(body, { status: res.status, headers });
  headers.set("Content-Encoding", "gzip");
  headers.delete("content-length");
  return new Response(gzipSync(body, { level: 6 }), { status: res.status, headers });
}

/** Wrap a handler so unexpected errors become a clean 500 instead of a crash page. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await maybeCompress(args[0], await fn(...args));
    } catch (err) {
      return serverError(err);
    }
  };
}

/**
 * Admin actions: require ADMIN_TOKEN when set; otherwise the request must come from this
 * computer and not from another website. (req.url's host is the server's bind address,
 * not the caller's, so the Host header and Fetch Metadata are what count. src/proxy.ts
 * enforces the same rules for every /api route.)
 */
export function isAdminRequest(req: Request): boolean {
  const token = env().ADMIN_TOKEN;
  if (token) return req.headers.get("authorization") === `Bearer ${token}`;
  const host = req.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i.test(host)) return false;
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
