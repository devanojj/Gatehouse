import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@libsql/client";

import { scratchFile } from "./helpers/harness.mjs";

const { MIGRATIONS, runMigrations } = await import("../src/lib/migrations");

function freshClient(name: string) {
  return createClient({ url: `file:${scratchFile(name)}` });
}

async function appliedNames(client: ReturnType<typeof createClient>) {
  const result = await client.execute(
    `SELECT name FROM migrations ORDER BY name`,
  );
  return result.rows.map((row) => String(row.name));
}

async function columnsOf(
  client: ReturnType<typeof createClient>,
  table: string,
) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(info.rows.map((row) => String(row.name)));
}

test("an empty database gets every migration exactly once", async () => {
  const client = freshClient("fresh.db");

  await runMigrations(client);
  assert.deepEqual(
    await appliedNames(client),
    MIGRATIONS.map((migration) => migration.name),
  );

  // The second pass is what a second process — or the next deploy — does.
  await runMigrations(client);
  assert.equal((await appliedNames(client)).length, MIGRATIONS.length);
});

test("two instances booting at once apply each migration once", async () => {
  // Separate clients, one file: what a deploy does when two instances take
  // their first request at the same moment. One wins the write lock and the
  // other waits rather than failing the request it was serving.
  const file = scratchFile("concurrent.db");
  const first = createClient({ url: `file:${file}` });
  const second = createClient({ url: `file:${file}` });

  await Promise.all([runMigrations(first), runMigrations(second)]);

  assert.deepEqual(
    await appliedNames(first),
    MIGRATIONS.map((migration) => migration.name),
  );
});

/*
 * The case the old `CREATE TABLE IF NOT EXISTS` path could not handle: a
 * database that already holds live rows in the pre-migration shape. This is
 * what production looks like on the first deploy after this change.
 */
test("a pre-migration database converges without losing rows", async () => {
  const client = freshClient("legacy.db");

  await client.batch(
    [
      `CREATE TABLE organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES organizations(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE tickets (
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
      `CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES organizations(id),
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        agent_id INTEGER REFERENCES agents(id),
        type TEXT NOT NULL DEFAULT 'internal',
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO organizations (name) VALUES ('Legacy Co')`,
      `INSERT INTO tickets (org_id, subject, status) VALUES (1, 'Old ticket', 'in-progress')`,
      `INSERT INTO tickets (org_id, subject, status, updated_at)
         VALUES (1, 'Old closed ticket', 'closed', '2026-01-02 03:04:05')`,
    ],
    "write",
  );

  await runMigrations(client);

  const orgColumns = await columnsOf(client, "organizations");
  assert.ok(orgColumns.has("support_email"), "support_email should be added");
  assert.ok(orgColumns.has("inbound_slug"), "inbound_slug should be added");

  const ticketColumns = await columnsOf(client, "tickets");
  for (const column of ["source_message_id", "resolved_at", "first_response_at"]) {
    assert.ok(ticketColumns.has(column), `${column} should be added`);
  }

  const slug = await client.execute(
    `SELECT inbound_slug FROM organizations WHERE id = 1`,
  );
  assert.match(
    String(slug.rows[0].inbound_slug),
    /^legacy-co-[a-z0-9]{6}$/,
    "an organization that predates inbound mail should be given a slug",
  );

  const statuses = await client.execute(
    `SELECT id, status, resolved_at FROM tickets ORDER BY id`,
  );
  assert.equal(statuses.rows.length, 2, "no row should be lost");
  assert.equal(statuses.rows[0].status, "in_progress");
  assert.equal(
    statuses.rows[1].resolved_at,
    "2026-01-02 03:04:05",
    "a ticket closed before resolved_at existed should be backfilled",
  );

  const events = await client.execute(`SELECT COUNT(*) AS n FROM ticket_events`);
  assert.equal(Number(events.rows[0].n), 0, "ticket_events should exist and be empty");

  // Queues arrive after the rows do, so the migration has to invent the default
  // and put every existing ticket in it.
  const queues = await client.execute(
    `SELECT id, name, is_default FROM queues WHERE org_id = 1`,
  );
  assert.equal(queues.rows.length, 1);
  assert.equal(queues.rows[0].name, "General");
  assert.equal(Number(queues.rows[0].is_default), 1);

  const unrouted = await client.execute(
    `SELECT COUNT(*) AS n FROM tickets WHERE queue_id IS NULL`,
  );
  assert.equal(
    Number(unrouted.rows[0].n),
    0,
    "every existing ticket should have been put in the default queue",
  );
});

test("a failing migration is rolled back and named", async () => {
  const client = freshClient("failure.db");
  await runMigrations(client);

  const broken = [
    ...MIGRATIONS,
    {
      name: "999_broken",
      up: async (tx: Parameters<(typeof MIGRATIONS)[number]["up"]>[0]) => {
        await tx.execute(`CREATE TABLE half_applied (id INTEGER PRIMARY KEY)`);
        await tx.execute(`SELECT this_is_not_a_function()`);
      },
    },
  ];

  await assert.rejects(
    () => runMigrations(client, broken),
    /999_broken/,
    "the error should name the migration that failed",
  );

  const tables = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_applied'`,
  );
  assert.equal(tables.rows.length, 0, "the failed migration should leave nothing behind");

  assert.ok(!(await appliedNames(client)).includes("999_broken"));
});
