import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { buildingsLayer, hillshadeLayer } from "@/components/globe/style";

describe("drop-in 3D layers", () => {
  it("are valid MapLibre layers (an invalid one is silently dropped and the city renders flat)", () => {
    const style = { version: 8, sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" }, "dropin-hillshade-dem": { type: "raster-dem", tiles: ["https://x/{z}/{x}/{y}.png"] } }, layers: [buildingsLayer(), hillshadeLayer()] };
    expect(validateStyleMin(style as never).map((e: { message: string }) => e.message)).toEqual([]);
  });
});
