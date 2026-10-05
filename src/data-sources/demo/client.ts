import type { FetchContext } from "../types";
import type { DemoRaw } from "./types";

/** No network: the demo generator is driven purely by the clock. */
export async function fetchDemo(ctx: FetchContext): Promise<DemoRaw> {
  return { now: ctx.now };
}
