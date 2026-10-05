import "server-only";
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

/** Wrap a handler so unexpected errors become a clean 500 instead of a crash page. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return serverError(err);
    }
  };
}

/** Admin actions: require ADMIN_TOKEN when set, otherwise only loopback hosts. */
export function isAdminRequest(req: Request): boolean {
  const token = env().ADMIN_TOKEN;
  if (token) return req.headers.get("authorization") === `Bearer ${token}`;
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}
