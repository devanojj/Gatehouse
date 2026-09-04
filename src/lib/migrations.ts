import "server-only";

import type { Client, Transaction } from "@libsql/client";

import { newInboundSlug, slugifyOrgName, SLUG_ATTEMPTS } from "./slug";

/**
 * Ordered, run-once schema changes.
 *
 * A migration is applied inside a write transaction together with the row that
 * records it, so the database can never believe a half-applied migration
 * finished. Names are permanent: renaming one makes every existing database
 * run it a second time.
 *
 * Write each `up` so that re-running it on a database that already has the
 * change is harmless anyway. The transaction makes that belt-and-braces rather
 * than load-bearing, but it costs nothing and it keeps a migration usable as a
 * repair.
 */
export type Migration = {
  name: string;
  up: (tx: Transaction) => Promise<void>;
};

async function run(tx: Transaction, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await tx.execute(statement);
  }
}

/**
 * Adds a column only when it is missing. SQLite has no `ADD COLUMN IF NOT
 * EXISTS`, and every column added here is nullable with no default, so the
 * `ALTER` is an instant metadata change rather than a table rewrite.
 */
async function addColumn(
  tx: Transaction,
  table: string,
  column: string,
  type = "TEXT",
): Promise<void> {
  const info = await tx.execute(`PRAGMA table_info(${table})`);
  const existing = new Set(info.rows.map((row) => String(row.name)));

  if (existing.has(column)) return;

  await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export const MIGRATIONS: Migration[] = [
  {
    // The state of the schema before migrations existed. Every statement is
    // conditional, so this converges a database built by the old lazy
    // `CREATE TABLE IF NOT EXISTS` path instead of colliding with it.
    name: "001_baseline",
    up: async (tx) => {
      await run(tx, [
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
        // Tenant-scoped lookups always lead with org_id, so the indexes do too.
        `CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_comments_org_ticket ON comments(org_id, ticket_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id, name)`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
        `CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token)`,
      ]);

      // Columns that arrived after the first release. A database created before
      // inbound email has the tables but not these.
      await addColumn(tx, "organizations", "support_email");
      await addColumn(tx, "organizations", "inbound_slug");
      await addColumn(tx, "tickets", "source_message_id");
      await addColumn(tx, "comments", "author_email");
      await addColumn(tx, "comments", "source_message_id");

      await run(tx, [
        // SQLite allows repeated NULLs under a unique index, so organizations
        // without a slug yet do not collide with each other.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_inbound_slug
           ON organizations(inbound_slug)`,
        // One inbound message may never land twice in the same tenant, whatever
        // the IMAP \Seen flag says.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_source_message
           ON tickets(org_id, source_message_id) WHERE source_message_id IS NOT NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_source_message
           ON comments(org_id, source_message_id) WHERE source_message_id IS NOT NULL`,
        // Threading a reply onto the sender's most recent open ticket.
        `CREATE INDEX IF NOT EXISTS idx_tickets_requester
           ON tickets(org_id, requester_email, created_at DESC)`,
      ]);

      await backfillInboundSlugs(tx);
    },
  },

  {
    // open / in-progress / closed becomes the five-state model: the hyphen goes,
    // and pending_customer and resolved arrive between in_progress and closed.
    name: "002_status_model",
    up: async (tx) => {
      await addColumn(tx, "tickets", "resolved_at");
      await addColumn(tx, "tickets", "first_response_at");

      await tx.execute(
        `UPDATE tickets SET status = 'in_progress' WHERE status = 'in-progress'`,
      );

      // Closed tickets predate resolved_at. `updated_at` is the closest thing
      // to a resolution time the old rows recorded, and leaving it NULL would
      // silently drop them out of every resolution metric later.
      await tx.execute(
        `UPDATE tickets
            SET resolved_at = updated_at
          WHERE status = 'closed' AND resolved_at IS NULL`,
      );
    },
  },

  {
    // The ticket's history: who changed what, and when. Comments carry the
    // conversation; this carries everything else the timeline has to show.
    name: "003_ticket_events",
    up: async (tx) => {
      await run(tx, [
        // org_id is stored here as well as on the ticket, and filtered
        // directly, for the same reason comments carry theirs: a query that
        // forgets to constrain the ticket still cannot cross a tenant.
        `CREATE TABLE IF NOT EXISTS ticket_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          ticket_id INTEGER NOT NULL REFERENCES tickets(id),
          actor_agent_id INTEGER REFERENCES agents(id),
          kind TEXT NOT NULL,
          from_value TEXT,
          to_value TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_ticket_events_org_ticket
           ON ticket_events(org_id, ticket_id, created_at, id)`,
      ]);
    },
  },

  {
    // Queues: every ticket belongs to exactly one, and every org has a default
    // for anything that has not been routed anywhere else.
    name: "004_queues",
    up: async (tx) => {
      await run(tx, [
        `CREATE TABLE IF NOT EXISTS queues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_org_slug
           ON queues(org_id, slug)`,
        `CREATE INDEX IF NOT EXISTS idx_queues_org
           ON queues(org_id, name COLLATE NOCASE)`,
        // At most one default per organization, enforced by the database rather
        // than by whichever code path last wrote the flag.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_org_default
           ON queues(org_id) WHERE is_default = 1`,
      ]);

      // SQLite cannot add a NOT NULL column to a populated table without
      // rebuilding it, so the column is nullable here and `createTicket` is
      // what guarantees every new row has one. Nothing reads a NULL queue after
      // the backfill below.
      await addColumn(tx, "tickets", "queue_id", "INTEGER REFERENCES queues(id)");

      await tx.execute(
        `INSERT INTO queues (org_id, name, slug, is_default)
         SELECT o.id, 'General', 'general', 1
           FROM organizations o
          WHERE NOT EXISTS (
                SELECT 1 FROM queues q WHERE q.org_id = o.id AND q.is_default = 1
              )`,
      );

      await tx.execute(
        `UPDATE tickets
            SET queue_id = (
                  SELECT q.id FROM queues q
                   WHERE q.org_id = tickets.org_id AND q.is_default = 1
                )
          WHERE queue_id IS NULL`,
      );

      await tx.execute(
        `CREATE INDEX IF NOT EXISTS idx_tickets_org_queue
           ON tickets(org_id, queue_id, created_at DESC)`,
      );
    },
  },

  {
    // The customer side: a second identity realm, with its own links, its own
    // sessions, and no overlap with `agents`. A person may be a customer of
    // several organizations, so identity is unique per org rather than global.
    name: "005_customer_portal",
    up: async (tx) => {
      await run(tx, [
        `CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          email TEXT NOT NULL,
          name TEXT,
          verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_email
           ON customers(org_id, email)`,
        `CREATE TABLE IF NOT EXISTS customer_magic_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS customer_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_customer_sessions_token
           ON customer_sessions(token)`,
        `CREATE INDEX IF NOT EXISTS idx_customer_magic_links_token
           ON customer_magic_links(token)`,
      ]);

      await addColumn(tx, "organizations", "portal_slug");
      await addColumn(
        tx,
        "tickets",
        "requester_customer_id",
        "INTEGER REFERENCES customers(id)",
      );
      // The one-off link handed out at submission time. It is not a session:
      // it opens a single ticket's confirmation and it expires.
      await addColumn(tx, "tickets", "public_token");
      await addColumn(tx, "tickets", "public_token_expires_at");

      await run(tx, [
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_portal_slug
           ON organizations(portal_slug)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_public_token
           ON tickets(public_token) WHERE public_token IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_requester_customer
           ON tickets(org_id, requester_customer_id, created_at DESC)`,
      ]);

      await backfillPortalSlugs(tx);
    },
  },
];

/**
 * Gives every organization a readable slug for its customer portal.
 *
 * Deliberately not the inbound slug: that one carries a random suffix precisely
 * so a stranger cannot guess another tenant's mail address, while this one is
 * printed in a URL customers are meant to read and retype. Tying them together
 * would mean neither could change without breaking the other.
 */
async function backfillPortalSlugs(tx: Transaction): Promise<void> {
  const pending = await tx.execute(
    `SELECT id, name FROM organizations WHERE portal_slug IS NULL`,
  );

  for (const row of pending.rows) {
    const id = Number(row.id);
    const base = slugifyOrgName(String(row.name));

    for (let suffix = 1; ; suffix++) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;

      const taken = await tx.execute({
        sql: `SELECT 1 FROM organizations WHERE portal_slug = ?`,
        args: [candidate],
      });

      if (taken.rows.length === 0) {
        await tx.execute({
          sql: `UPDATE organizations SET portal_slug = ? WHERE id = ?`,
          args: [candidate, id],
        });
        break;
      }
    }
  }
}

/**
 * How long to keep waiting for another process that is mid-migration. Two
 * instances booting at once is the ordinary case on a deploy, and the one that
 * loses the write lock is told so immediately rather than being made to wait —
 * so waiting is this function's job.
 */
const BUSY_RETRIES = 10;
const BUSY_BACKOFF_MS = 100;
const BUSY_BACKOFF_MAX_MS = 400;

function backoffFor(attempt: number): number {
  return Math.min(BUSY_BACKOFF_MS * (attempt + 1), BUSY_BACKOFF_MAX_MS);
}

function isLocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Applies every migration the database has not seen, in order.
 *
 * The applied-check runs inside the same write transaction as the migration, so
 * two processes starting at once cannot both apply one: SQLite serializes the
 * write lock, and whichever waits sees the row the other committed.
 */
export async function runMigrations(
  client: Client,
  migrations: Migration[] = MIGRATIONS,
): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );

  for (const migration of migrations) {
    await applyOne(client, migration);
  }
}

async function applyOne(client: Client, migration: Migration): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const tx = await client.transaction("write").catch((error: unknown) => {
      if (isLocked(error) && attempt < BUSY_RETRIES) return null;
      throw error;
    });

    if (!tx) {
      await sleep(backoffFor(attempt));
      continue;
    }

    try {
      const applied = await tx.execute({
        sql: `SELECT 1 FROM migrations WHERE name = ?`,
        args: [migration.name],
      });

      if (applied.rows.length > 0) {
        await tx.rollback();
        return;
      }

      await migration.up(tx);
      await tx.execute({
        sql: `INSERT INTO migrations (name) VALUES (?)`,
        args: [migration.name],
      });
      await tx.commit();
      return;
    } catch (error) {
      await tx.rollback().catch(() => {});

      if (isLocked(error) && attempt < BUSY_RETRIES) {
        await sleep(backoffFor(attempt));
        continue;
      }

      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Migration ${migration.name} failed and was rolled back: ${detail}`,
        { cause: error },
      );
    }
  }
}

/**
 * Gives a routing slug to organizations created before inbound email existed.
 * Without one their settings page has no address to show.
 */
async function backfillInboundSlugs(tx: Transaction): Promise<void> {
  const pending = await tx.execute(
    `SELECT id, name FROM organizations WHERE inbound_slug IS NULL`,
  );

  for (const row of pending.rows) {
    const id = Number(row.id);
    const name = String(row.name);

    // The unique index is the real arbiter; retry if a generated slug is taken.
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      try {
        await tx.execute({
          sql: `UPDATE organizations SET inbound_slug = ?
                 WHERE id = ? AND inbound_slug IS NULL`,
          args: [newInboundSlug(name), id],
        });
        break;
      } catch (error) {
        if (attempt === SLUG_ATTEMPTS - 1) throw error;
      }
    }
  }
}
