/**
 * Server-side environment configuration. Never import from client components —
 * secrets must not reach the browser.
 */
import "server-only";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const EnvSchema = z.object({
  /** "live" ingests real public data; "demo" shows clearly-labelled synthetic events only */
  WORLDVIEW_DATA_MODE: z.enum(["live", "demo"]).default("live"),
  INGESTION_ENABLED: bool(true),
  /** Where the local repository persists its snapshot */
  DATA_DIR: z.string().default(".data"),
  /** How many days of events to keep */
  RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(8),
  /** Optional contact for upstream User-Agent headers (api.weather.gov asks for one) */
  WORLDVIEW_CONTACT: z.string().optional(),
  /** Optional token protecting POST /api/ingest/:source. When unset, only localhost may trigger. */
  ADMIN_TOKEN: z.string().optional(),

  NASA_FIRMS_MAP_KEY: z.string().optional(),
  AISSTREAM_API_KEY: z.string().optional(),
  OPENSKY_CLIENT_ID: z.string().optional(),
  OPENSKY_CLIENT_SECRET: z.string().optional(),

  /** local = keyless on-device model (default); anthropic = hosted (needs AI_API_KEY); none = off */
  AI_PROVIDER: z.enum(["local", "anthropic", "none"]).default("local"),
  /** Override the local model (node-llama-cpp URI, e.g. hf:<user>/<repo>:<quant>) */
  AI_LOCAL_MODEL: z.string().optional(),
  /** Unload the on-device model after this many idle minutes (0 = keep loaded) */
  /** Optional iMessage text of the morning briefing via the Messages app (phone number or Apple ID; unset = off) */
  IMESSAGE_TO: z.string().optional(),
  /** Optional phone push for the morning briefing via ntfy (unset = off) */
  NTFY_TOPIC: z.string().optional(),
  NTFY_SERVER: z.string().url().optional(),
  AI_IDLE_UNLOAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(5),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

  /** Storage: unset = memory+JSON snapshot; "pglite[:path]" = embedded Postgres; "postgres://…" = server */
  DATABASE_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const k of Object.keys(EnvSchema.shape)) {
    const v = process.env[k];
    raw[k] = v === "" ? undefined : v;
  }
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[env] invalid environment:", parsed.error.issues);
    throw new Error("Invalid environment configuration — see .env.example");
  }
  cached = parsed.data;
  return cached;
}

export function userAgent(): string {
  const contact = env().WORLDVIEW_CONTACT;
  return `WorldView/0.1 (local development${contact ? `; ${contact}` : ""})`;
}
