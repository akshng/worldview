import { describe, expect, it } from "vitest";
import { guardDecision } from "@/proxy";

const ok = (h: Partial<{ host: string | null; secFetchSite: string | null; origin: string | null }>) => guardDecision({ host: "127.0.0.1:3000", secFetchSite: null, origin: null, ...h });

describe("API request guard", () => {
  it("lets the app, the Mac app and local scripts through", () => {
    expect(ok({ secFetchSite: "same-origin", origin: "http://127.0.0.1:3000" })).toBeNull();
    expect(ok({ host: "localhost:3000" })).toBeNull(); // curl / run-once jobs
    expect(ok({ secFetchSite: "none" })).toBeNull(); // typed into the address bar
  });
  it("blocks other websites (CSRF / drive-by)", () => {
    expect(ok({ secFetchSite: "cross-site", origin: "https://evil.example" })).toMatch(/Cross-site/);
    expect(ok({ secFetchSite: "same-site", origin: "http://localhost:5173" })).toMatch(/Cross-site/);
    expect(ok({ origin: "https://evil.example" })).toMatch(/Cross-origin/); // old browsers without Fetch Metadata
    expect(ok({ origin: "null" })).toMatch(/opaque/);
  });
  it("blocks DNS rebinding and other devices on the network", () => {
    expect(ok({ host: "evil.example:3000" })).toMatch(/only answers on this computer/);
    expect(ok({ host: "192.168.1.20:3000" })).toMatch(/only answers on this computer/);
    expect(ok({ host: null })).not.toBeNull();
  });
});
