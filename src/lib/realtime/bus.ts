/**
 * In-process realtime bus. API routes subscribe (SSE at /api/stream) and the
 * ingestion pipeline publishes. Replace with Redis pub/sub or a WebSocket
 * gateway when running multiple server instances — callers only use
 * `publish`/`subscribe`.
 */
import { EventEmitter } from "node:events";

export type RealtimeMessage =
  | { type: "events.changed"; version: number; dataSourceId: string; created: number; updated: number }
  | { type: "sources.changed"; dataSourceId: string }
  | { type: "event.updated"; eventId: string };

type Bus = { emitter: EventEmitter };
const g = globalThis as unknown as { __worldviewBus?: Bus };
const bus: Bus = g.__worldviewBus ?? (g.__worldviewBus = { emitter: new EventEmitter() });
bus.emitter.setMaxListeners(200);

export function publish(msg: RealtimeMessage) {
  bus.emitter.emit("message", msg);
}

export function subscribe(fn: (msg: RealtimeMessage) => void): () => void {
  bus.emitter.on("message", fn);
  return () => bus.emitter.off("message", fn);
}

/** Open realtime subscribers (≈ app tabs open). */
export function subscriberCount(): number {
  return bus.emitter.listenerCount("message");
}
