import { subscriberCount } from "@/lib/realtime/bus";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/viewers — open app tabs (realtime subscribers). Used by the power watcher. */
export function GET() {
  return json({ viewers: subscriberCount() });
}
