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

  {
    // Full-text search (FTS5) over tickets, comments, and requesters, plus
    // custom saved views for agents. Triggers keep the search index in step
    // with ticket and comment writes automatically.
    name: "006_search_and_saved_views",
    up: async (tx) => {
      await run(tx, [
        `CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
          ticket_id UNINDEXED,
          org_id UNINDEXED,
          comment_id UNINDEXED,
          title,
          body,
          requester,
          tokenize = 'unicode61'
        )`,
        `CREATE TRIGGER IF NOT EXISTS tickets_fts_ai AFTER INSERT ON tickets BEGIN
          INSERT INTO tickets_fts(ticket_id, org_id, comment_id, title, body, requester)
          VALUES (new.id, new.org_id, 0, new.subject, COALESCE(new.description, ''), COALESCE(new.requester_email, ''));
        END`,
        `CREATE TRIGGER IF NOT EXISTS tickets_fts_au AFTER UPDATE OF subject, description, requester_email ON tickets BEGIN
          DELETE FROM tickets_fts WHERE ticket_id = old.id AND comment_id = 0;
          INSERT INTO tickets_fts(ticket_id, org_id, comment_id, title, body, requester)
          VALUES (new.id, new.org_id, 0, new.subject, COALESCE(new.description, ''), COALESCE(new.requester_email, ''));
        END`,
        `CREATE TRIGGER IF NOT EXISTS tickets_fts_ad AFTER DELETE ON tickets BEGIN
          DELETE FROM tickets_fts WHERE ticket_id = old.id;
        END`,
        `CREATE TRIGGER IF NOT EXISTS comments_fts_ai AFTER INSERT ON comments BEGIN
          INSERT INTO tickets_fts(ticket_id, org_id, comment_id, title, body, requester)
          VALUES (new.ticket_id, new.org_id, new.id, '', new.body, COALESCE(new.author_email, ''));
        END`,
        `CREATE TRIGGER IF NOT EXISTS comments_fts_au AFTER UPDATE OF body ON comments BEGIN
          DELETE FROM tickets_fts WHERE comment_id = old.id;
          INSERT INTO tickets_fts(ticket_id, org_id, comment_id, title, body, requester)
          VALUES (new.ticket_id, new.org_id, new.id, '', new.body, COALESCE(new.author_email, ''));
        END`,
        `CREATE TRIGGER IF NOT EXISTS comments_fts_ad AFTER DELETE ON comments BEGIN
          DELETE FROM tickets_fts WHERE comment_id = old.id;
        END`,
        `CREATE TABLE IF NOT EXISTS saved_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          filters TEXT NOT NULL,
          created_by_agent_id INTEGER REFERENCES agents(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_saved_views_org
           ON saved_views(org_id, name COLLATE NOCASE)`,
      ]);

      const existing = await tx.execute(`SELECT COUNT(*) AS n FROM tickets_fts`);
      if (Number(existing.rows[0].n) === 0) {
        await tx.execute(`
          INSERT INTO tickets_fts (ticket_id, org_id, comment_id, title, body, requester)
          SELECT id, org_id, 0, subject, COALESCE(description, ''), COALESCE(requester_email, '')
            FROM tickets
        `);
        await tx.execute(`
          INSERT INTO tickets_fts (ticket_id, org_id, comment_id, title, body, requester)
          SELECT ticket_id, org_id, id, '', body, COALESCE(author_email, '')
            FROM comments
        `);
      }
    },
  },

  {
    // Knowledge base: categories, articles with draft/published lifecycle,
    // and full-text search over published content.
    name: "007_knowledge_base",
    up: async (tx) => {
      await run(tx, [
        `CREATE TABLE IF NOT EXISTS kb_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_categories_org_slug
           ON kb_categories(org_id, slug)`,
        `CREATE INDEX IF NOT EXISTS idx_kb_categories_org
           ON kb_categories(org_id, position, name COLLATE NOCASE)`,
        `CREATE TABLE IF NOT EXISTS articles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          category_id INTEGER REFERENCES kb_categories(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          slug TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          author_agent_id INTEGER REFERENCES agents(id),
          published_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_org_slug
           ON articles(org_id, slug)`,
        `CREATE INDEX IF NOT EXISTS idx_articles_org_status
           ON articles(org_id, status, updated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_articles_org_category
           ON articles(org_id, category_id, status)`,
        `CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
          article_id UNINDEXED,
          org_id UNINDEXED,
          title,
          body,
          tokenize = 'unicode61'
        )`,
        `CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
          INSERT INTO articles_fts(article_id, org_id, title, body)
          VALUES (new.id, new.org_id, new.title, new.body);
        END`,
        `CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE OF title, body ON articles BEGIN
          DELETE FROM articles_fts WHERE article_id = old.id;
          INSERT INTO articles_fts(article_id, org_id, title, body)
          VALUES (new.id, new.org_id, new.title, new.body);
        END`,
        `CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
          DELETE FROM articles_fts WHERE article_id = old.id;
        END`,
      ]);
    },
  },

  {
    // Service Level Agreements (SLA) tracking, priority targets, ticket deadlines,
    // and agent notification inbox.
    name: "008_sla_and_notifications",
    up: async (tx) => {
      await run(tx, [
        `CREATE TABLE IF NOT EXISTS sla_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          description TEXT,
          is_default INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sla_policies_org
           ON sla_policies(org_id, is_default DESC)`,
        `CREATE TABLE IF NOT EXISTS sla_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          policy_id INTEGER NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
          priority TEXT NOT NULL,
          first_response_hours INTEGER NOT NULL,
          resolution_hours INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_targets_policy_priority
           ON sla_targets(policy_id, priority)`,
        `CREATE INDEX IF NOT EXISTS idx_sla_targets_org
           ON sla_targets(org_id)`,
        `CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          agent_id INTEGER NOT NULL REFERENCES agents(id),
          ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          read_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_agent_unread
           ON notifications(org_id, agent_id, read_at, created_at DESC)`,
      ]);

      await addColumn(tx, "tickets", "sla_policy_id", "INTEGER");
      await addColumn(tx, "tickets", "sla_first_response_due_at", "TEXT");
      await addColumn(tx, "tickets", "sla_resolution_due_at", "TEXT");
      await addColumn(tx, "tickets", "sla_first_response_breached", "INTEGER NOT NULL DEFAULT 0");
      await addColumn(tx, "tickets", "sla_resolution_breached", "INTEGER NOT NULL DEFAULT 0");
      await addColumn(tx, "tickets", "sla_breached", "INTEGER NOT NULL DEFAULT 0");

      await run(tx, [
        `CREATE INDEX IF NOT EXISTS idx_tickets_sla_breached
           ON tickets(org_id, sla_breached, status)`,
      ]);

      await backfillDefaultSlaPolicies(tx);
    },
  },

  {
    name: "009_routing_and_audit",
    up: async (tx) => {
      await run(tx, [
        `CREATE TABLE IF NOT EXISTS routing_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          description TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          match_field TEXT NOT NULL,
          match_operator TEXT NOT NULL,
          match_value TEXT NOT NULL,
          target_queue_id INTEGER REFERENCES queues(id) ON DELETE SET NULL,
          target_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
          target_priority TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_routing_rules_org_pos
           ON routing_rules(org_id, position, is_active)`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_org_created
           ON tickets(org_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_org_resolved
           ON tickets(org_id, resolved_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_ticket_events_org_created
           ON ticket_events(org_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_ticket_events_org_kind
           ON ticket_events(org_id, kind, created_at DESC)`,
      ]);
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

/**
 * Ensures every existing organization has a default SLA policy and targets,
 * and sets default SLA deadlines on existing open tickets.
 */
async function backfillDefaultSlaPolicies(tx: Transaction): Promise<void> {
  const orgs = await tx.execute(`SELECT id FROM organizations`);

  for (const org of orgs.rows) {
    const orgId = Number(org.id);
    const existing = await tx.execute({
      sql: `SELECT id FROM sla_policies WHERE org_id = ? AND is_default = 1`,
      args: [orgId],
    });

    let policyId: number;
    if (existing.rows.length === 0) {
      const res = await tx.execute({
        sql: `INSERT INTO sla_policies (org_id, name, description, is_default)
              VALUES (?, 'Standard SLA', 'Default SLA policy for response and resolution targets.', 1)`,
        args: [orgId],
      });
      policyId = Number(res.lastInsertRowid);

      await tx.execute({
        sql: `INSERT OR IGNORE INTO sla_targets (org_id, policy_id, priority, first_response_hours, resolution_hours)
              VALUES (?, ?, 'high', 1, 8),
                     (?, ?, 'medium', 4, 24),
                     (?, ?, 'low', 8, 72)`,
        args: [orgId, policyId, orgId, policyId, orgId, policyId],
      });
    }
  }

  // Backfill deadlines on existing tickets that don't have them
  await tx.execute(`
    UPDATE tickets
       SET sla_first_response_due_at = datetime(created_at, '+1 hours'),
           sla_resolution_due_at = datetime(created_at, '+8 hours')
     WHERE priority = 'high' AND sla_first_response_due_at IS NULL
  `);
  await tx.execute(`
    UPDATE tickets
       SET sla_first_response_due_at = datetime(created_at, '+4 hours'),
           sla_resolution_due_at = datetime(created_at, '+24 hours')
     WHERE priority = 'medium' AND sla_first_response_due_at IS NULL
  `);
  await tx.execute(`
    UPDATE tickets
       SET sla_first_response_due_at = datetime(created_at, '+8 hours'),
           sla_resolution_due_at = datetime(created_at, '+72 hours')
     WHERE priority = 'low' AND sla_first_response_due_at IS NULL
  `);

  await tx.execute(`
    UPDATE tickets
       SET sla_first_response_breached = COALESCE(sla_first_response_breached, 0),
           sla_resolution_breached = COALESCE(sla_resolution_breached, 0),
           sla_breached = COALESCE(sla_breached, 0)
  `);
}

