import "server-only";

import { createClient, type Client } from "@libsql/client";

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

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    requester_email TEXT,
    assigned_agent_id INTEGER REFERENCES agents(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    agent_id INTEGER REFERENCES agents(id),
    type TEXT NOT NULL DEFAULT 'internal',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Tenant-scoped lookups always lead with org_id, so the indexes do too.
  `CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_org_ticket ON comments(org_id, ticket_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
  `CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token)`,
];

let ready: Promise<void> | undefined;

/**
 * Creates the schema on first use. Memoized per process, so the cost is one
 * batch on the first request and nothing thereafter.
 *
 * A failure here breaks every query in the app, so it is worth naming the exact
 * statement that failed. The usual cause is pointing at a database that already
 * holds a different app's tables: `CREATE TABLE IF NOT EXISTS` quietly skips the
 * conflicting table, and the first statement that depends on a missing column is
 * the one that blows up.
 */
function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = runSchema().catch((error) => {
      // Let the next request retry rather than caching the failure forever.
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

async function runSchema(): Promise<void> {
  const client = getClient();

  try {
    await client.batch(SCHEMA, "write");
  } catch {
    // Re-run one at a time so the error can name the offending statement
    // instead of surfacing as an opaque 500.
    for (const statement of SCHEMA) {
      try {
        await client.execute(statement);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Gatehouse could not set up its schema.\n` +
            `Failing statement: ${statement.replace(/\s+/g, " ").trim()}\n` +
            `Database error: ${detail}\n` +
            `Database URL: ${describeTarget()}\n` +
            `If that database already contains another app's tables, point ` +
            `TURSO_DATABASE_URL at a fresh database — Gatehouse cannot share one.`,
          { cause: error },
        );
      }
    }
  }
}

/** The host only — never the auth token. */
function describeTarget(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "(unset)";
  return url.startsWith("file:") ? url : url.split("?")[0];
}

export type Row = Record<string, unknown>;

export async function query<T = Row>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql,
    args: args as never,
  });
  return result.rows as unknown as T[];
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
