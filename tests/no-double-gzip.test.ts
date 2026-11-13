import { describe, expect, it } from "vitest";
import { handler, json } from "@/lib/server/http";

describe("API responses", () => {
  it("are not compressed by the app (Next.js compresses them; doing it twice breaks browsers)", async () => {
    const big = { events: Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, title: "x".repeat(40) })) };
    const route = handler(async (_req: Request) => json(big));
    const res = await route(new Request("http://127.0.0.1:3000/api/events", { headers: { "accept-encoding": "gzip, br" } }));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.json()).events).toHaveLength(2000);
  });
});
