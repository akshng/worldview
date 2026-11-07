import { describe, expect, it } from "vitest";
import { bucketCounts } from "@/lib/charts/specs";

describe("charts", () => {
  it("counts events into day buckets ending now, oldest first", () => {
    const now = Date.UTC(2026, 10, 6, 12);
    const DAY = 86_400_000;
    const pts = bucketCounts([now - 0.5 * DAY, now - 0.2 * DAY, now - 2.5 * DAY, now - 10 * DAY], now, 3, DAY);
    expect(pts).toHaveLength(3);
    expect(pts.map((p) => p[1])).toEqual([1, 0, 2]);
    expect(pts[0][0]).toBe(now - 3 * DAY);
  });
});
