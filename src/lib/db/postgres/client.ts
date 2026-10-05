/**
 * Minimal SQL client abstraction so one repository implementation works with
 * a Postgres server (node-postgres) and with embedded PGlite (Postgres in WASM).
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SqlClient extends Queryable {
  readonly kind: "postgres" | "pglite";
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Embedded Postgres. `dataDir` null = in-memory (tests). */
export async function createPgliteClient(dataDir: string | null): Promise<SqlClient> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  return {
    kind: "pglite",
    query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await db.query<T>(text, params as unknown[])).rows }),
    exec: async (sql) => {
      await db.exec(sql);
    },
    transaction: (fn) => db.transaction((tx) => fn({ query: async <T,>(t: string, p?: unknown[]) => ({ rows: (await tx.query<T>(t, p as unknown[])).rows }) })),
    close: () => db.close(),
  };
}

/** Postgres server via node-postgres. `schema` isolates live vs demo data. */
export async function createPgClient(connectionString: string, schema: string): Promise<SqlClient> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 5, options: `-c search_path=${schema}` });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  return {
    kind: "postgres",
    query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pool.query(text, params as unknown[])).rows as T[] }),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const out = await fn({ query: async <T,>(t: string, p?: unknown[]) => ({ rows: (await conn.query(t, p as unknown[])).rows as T[] }) });
        await conn.query("COMMIT");
        return out;
      } catch (err) {
        await conn.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}
