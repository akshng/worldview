/**
 * Runs once when the server starts. Warms the background layers (the public camera
 * list from ~30 operator feeds) so the first request doesn't wait on upstream.
 * Not awaited: the server starts serving straight away.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLayerBackground } = await import("@/layers/registry");
  startLayerBackground();
}
