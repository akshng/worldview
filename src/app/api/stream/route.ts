import { getRepository } from "@/lib/server/context";
import { subscribe } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";

/**
 * GET /api/stream — Server-Sent Events. Pushes lightweight change notifications;
 * clients re-fetch the data they need. Heartbeat every 25 s.
 */
export async function GET(req: Request) {
  const repo = await getRepository();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("hello", { version: repo.version() });
      const unsub = subscribe((msg) => send(msg.type, msg));
      const hb = setInterval(() => send("ping", { t: Date.now() }), 25_000);
      cleanup = () => {
        clearInterval(hb);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
