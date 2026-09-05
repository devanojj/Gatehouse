import "server-only";

import { createClient, type Client } from "@libsql/client";

import { runMigrations } from "./migrations";

let client: Client | undefined;

function getClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Copy .env.local.example to .env.local and fill it in.",
    );
  }

  client = createClient({
    url,
    // A `file:` URL (plain local SQLite) takes no auth token.
    authToken: url.startsWith("file:")
      ? undefined
      : process.env.TURSO_AUTH_TOKEN,
  });

  return client;
}

let ready: Promise<void> | undefined;

/**
 * Brings the database up to date on first use. Memoized per process, so the
 * cost is one pass on the first request and nothing thereafter — which is what
 * keeps local setup to "point at a file and go", with no migration step to run
 * by hand.
 *
 * A failure here breaks every query in the app, so the error names the
 * migration that failed and the database it was pointed at.
 */
function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = runMigrations(getClient()).catch((error) => {
      // Let the next request retry rather than caching the failure forever.
      ready = undefined;

      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Gatehouse could not set up its schema.\n` +
          `${detail}\n` +
          `Database URL: ${describeTarget()}\n` +
          `If that database already contains another app's tables, point ` +
          `TURSO_DATABASE_URL at a fresh database — Gatehouse cannot share one.`,
        { cause: error },
      );
    });
  }
  return ready;
}

/** The host only — never the auth token. */
function describeTarget(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "(unset)";
  return url.startsWith("file:") ? url : url.split("?")[0];
}

/**
 * Timestamp for rows that share one chronology.
 *
 * `datetime('now')` only resolves to the second, which is not enough for a
 * timeline built from two tables: a reply and the status change it caused land
 * in the same second, and nothing in the data says which came first. The `%f`
 * form keeps milliseconds, stays fixed-width so it still sorts as a string, and
 * still parses in `format.ts`.
 */
export const TIMELINE_NOW = `strftime('%Y-%m-%d %H:%M:%f', 'now')`;

export type Row = Record<string, unknown>;

/**
 * libSQL hands back `Row` objects — array-like, with a prototype, and carrying
 * numeric indices alongside the column names. React refuses to serialize those
 * across the Server/Client Component boundary ("Only plain objects can be
 * passed..."), and a row that reaches a client component would ship every
 * column it holds to the browser besides.
 *
 * Rebuilding each row from `result.columns` gives a plain object with exactly
 * the named columns and nothing else, once, here — rather than each caller
 * remembering to do it.
 */
function toPlainRows<T>(result: {
  columns: string[];
  rows: unknown[];
}): T[] {
  return result.rows.map((row) => {
    const plain: Row = {};
    result.columns.forEach((column, index) => {
      plain[column] = (row as Record<number, unknown>)[index];
    });
    return plain as T;
  });
}

export async function query<T = Row>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql,
    args: args as never,
  });
  return toPlainRows<T>(result);
}

export async function queryOne<T = Row>(
  sql: string,
  args: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/** Runs a write and returns the id of the inserted row. */
export async function insert(sql: string, args: unknown[] = []): Promise<number> {
  await ensureSchema();
  const result = await getClient().execute({ sql, args: args as never });
  return Number(result.lastInsertRowid);
}

export async function execute(sql: string, args: unknown[] = []): Promise<void> {
  await ensureSchema();
  await getClient().execute({ sql, args: args as never });
}

/** How many rows a write touched — for conditional updates that may match none. */
export async function executeCounting(
  sql: string,
  args: unknown[] = [],
): Promise<number> {
  await ensureSchema();
  const result = await getClient().execute({ sql, args: args as never });
  return result.rowsAffected;
}

/**
 * Runs the pending migrations without going through a query. Only the test
 * harness needs this; the app reaches them through any of the helpers above.
 */
export async function migrate(): Promise<void> {
  await ensureSchema();
}
