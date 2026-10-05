/**
 * Repository factory.
 *
 *   DATABASE_URL unset                 → in-memory store + JSON snapshot in DATA_DIR (default)
 *   DATABASE_URL=pglite                → embedded Postgres (PGlite) in DATA_DIR/pglite-<mode>
 *   DATABASE_URL=pglite:///abs/path    → embedded Postgres at that directory (suffixed by mode)
 *   DATABASE_URL=postgres://…          → PostgreSQL server; schema worldview_<mode>
 *
 * Live and demo data are always kept in separate stores.
 */
import "server-only";
import path from "node:path";
import type { EventRepository } from "./types";
import { MemoryEventRepository } from "./memory-repository";

export async function createRepository(opts: { databaseUrl?: string; dataDir: string; mode: "live" | "demo" }): Promise<EventRepository> {
  const url = opts.databaseUrl?.trim();
  if (!url) return new MemoryEventRepository(path.resolve(process.cwd(), opts.dataDir, `${opts.mode}-store.json`));

  const { PostgresEventRepository } = await import("./postgres/repository");
  if (url === "pglite" || url.startsWith("pglite:")) {
    const { createPgliteClient } = await import("./postgres/client");
    const custom = url.replace(/^pglite:(\/\/)?/, "").replace(/^pglite$/, "");
    const base = custom ? path.resolve(custom) : path.resolve(process.cwd(), opts.dataDir, "pglite");
    return new PostgresEventRepository(await createPgliteClient(`${base}-${opts.mode}`));
  }
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { createPgClient } = await import("./postgres/client");
    return new PostgresEventRepository(await createPgClient(url, `worldview_${opts.mode}`));
  }
  throw new Error(`Unsupported DATABASE_URL (expected postgres://… or pglite[:path])`);
}
