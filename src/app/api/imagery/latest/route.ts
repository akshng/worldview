import { getLatestImagery } from "@/lib/imagery/server";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/imagery/latest — latest NASA GIBS image time per satellite layer. Cached 5 min. */
export const GET = handler(async () => json(await getLatestImagery()));
