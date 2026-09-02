import "server-only";

import { createClient, type Client } from "@libsql/client";

import { newInboundSlug } from "./slug";

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
    support_email TEXT,
    inbound_slug TEXT,
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
    source_message_id TEXT,
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
    author_email TEXT,
    source_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // A queue only ever holds agents of its own organization; `org_id` is carried
  // here too so membership can be filtered without joining through `queues`.
  `CREATE TABLE IF NOT EXISTS queue_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    queue_id INTEGER NOT NULL REFERENCES queues(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (queue_id, agent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS macros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Append-only: rows are written beside the mutation they describe and never
  // updated or deleted, so the timeline of a ticket cannot be rewritten.
  `CREATE TABLE IF NOT EXISTS ticket_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    agent_id INTEGER REFERENCES agents(id),
    type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    comment_id INTEGER REFERENCES comments(id),
    agent_id INTEGER REFERENCES agents(id),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Tenant-scoped lookups always lead with org_id, so the indexes do too.
  `CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_org_ticket ON comments(org_id, ticket_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
  `CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token)`,
  `CREATE INDEX IF NOT EXISTS idx_queues_org ON queues(org_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_members_org_queue
     ON queue_members(org_id, queue_id)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_members_org_agent
     ON queue_members(org_id, agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_macros_org ON macros(org_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_events_org_ticket
     ON ticket_events(org_id, ticket_id, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_org_ticket
     ON attachments(org_id, ticket_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_org_comment
     ON attachments(org_id, comment_id)`,
];

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` silently
 * skips a table that already exists, so a database created before inbound email
 * needs these bolted on explicitly.
 */
/** How many times to re-roll a generated slug before giving up on a collision. */
export const SLUG_ATTEMPTS = 5;

const ADDED_COLUMNS = [
  { table: "organizations", column: "support_email" },
  { table: "organizations", column: "inbound_slug" },
  { table: "tickets", column: "source_message_id" },
  { table: "tickets", column: "queue_id", type: "INTEGER" },
  { table: "comments", column: "author_email" },
  { table: "comments", column: "source_message_id" },
] as const;

/**
 * Indexes over the columns above. These run after the migration, never in the
 * main batch: on an older database the columns do not exist yet when the batch
 * is executed.
 */
const POST_MIGRATION_INDEXES = [
  // SQLite allows repeated NULLs under a unique index, so organizations that
  // have not been given a slug yet do not collide with each other.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_inbound_slug
     ON organizations(inbound_slug)`,
  // One inbound message may never land twice in the same tenant, whatever the
  // IMAP \Seen flag says.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_source_message
     ON tickets(org_id, source_message_id) WHERE source_message_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_source_message
     ON comments(org_id, source_message_id) WHERE source_message_id IS NOT NULL`,
  // Threading a reply onto the sender's most recent open ticket.
  `CREATE INDEX IF NOT EXISTS idx_tickets_requester
     ON tickets(org_id, requester_email, created_at DESC)`,
  // The queue views on the ticket list.
  `CREATE INDEX IF NOT EXISTS idx_tickets_queue
     ON tickets(org_id, queue_id, created_at DESC)`,
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

  await createTables(client);
  await addMissingColumns(client);

  for (const statement of POST_MIGRATION_INDEXES) {
    await client.execute(statement);
  }

  await backfillInboundSlugs(client);
}

async function createTables(client: Client): Promise<void> {
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

/**
 * Adds any column in `ADDED_COLUMNS` that the database is missing.
 *
 * All of them are nullable with no default, so `ALTER TABLE ... ADD COLUMN` is
 * an instant metadata change on an existing table — no rewrite, no downtime.
 * `type` defaults to TEXT; a column holding a row id says so, since SQLite
 * compares an integer against the text `'3'` as unequal.
 */
async function addMissingColumns(client: Client): Promise<void> {
  const seen = new Map<string, Set<string>>();

  for (const definition of ADDED_COLUMNS) {
    const { table, column } = definition;
    const type = "type" in definition ? definition.type : "TEXT";
    let columns = seen.get(table);
    if (!columns) {
      const info = await client.execute(`PRAGMA table_info(${table})`);
      columns = new Set(info.rows.map((row) => String(row.name)));
      seen.set(table, columns);
    }

    if (columns.has(column)) continue;

    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    columns.add(column);
  }
}

/**
 * Gives a routing slug to organizations created before inbound email existed.
 * Without one their settings page has no address to show.
 */
async function backfillInboundSlugs(client: Client): Promise<void> {
  const pending = await client.execute(
    `SELECT id, name FROM organizations WHERE inbound_slug IS NULL`,
  );

  for (const row of pending.rows) {
    const id = Number(row.id);
    const name = String(row.name);

    // The unique index is the real arbiter; retry if a generated slug is taken.
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      try {
        await client.execute({
          sql: `UPDATE organizations SET inbound_slug = ? WHERE id = ? AND inbound_slug IS NULL`,
          args: [newInboundSlug(name), id],
        });
        break;
      } catch (error) {
        if (attempt === SLUG_ATTEMPTS - 1) throw error;
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

/** One parameterized statement, for `batchWrite`. */
export type Statement = { sql: string; args: unknown[] };

/**
 * Runs several writes in one transaction.
 *
 * This is how a mutation and the `ticket_events` row describing it are written
 * together: libSQL wraps a batch in a transaction, so either both land or
 * neither does and the timeline cannot drift from the ticket it describes.
 */
export async function batchWrite(statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await ensureSchema();
  await getClient().batch(
    statements.map(({ sql, args }) => ({ sql, args: args as never })),
    "write",
  );
}
