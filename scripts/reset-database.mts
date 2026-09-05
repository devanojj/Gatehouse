/**
 * Empties a Gatehouse database so the migration runner can rebuild it.
 *
 * Gatehouse cannot share a database with another application: its migrations
 * use `CREATE TABLE IF NOT EXISTS`, so a table of the same name and a different
 * shape is silently skipped, and the next statement that needs a missing column
 * fails. This is the repair for that, and the setup step when adopting a
 * database that already holds something else.
 *
 * It drops every table it finds. Nothing is recoverable afterwards, so it
 * refuses to run without CONFIRM=drop-everything and prints the target and the
 * table list first:
 *
 *   npm run db:reset                          # shows what it would do
 *   CONFIRM=drop-everything npm run db:reset  # does it
 *
 * Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment, falling
 * back to .env.local.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@libsql/client";

function fromEnvFile(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter(
          (line) => line.trim() && !line.trim().startsWith("#") && line.includes("="),
        )
        .map((line) => {
          const at = line.indexOf("=");
          return [
            line.slice(0, at).trim(),
            line
              .slice(at + 1)
              .trim()
              .replace(/^["']|["']$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
}

const fileEnv = fromEnvFile();
const url = process.env.TURSO_DATABASE_URL ?? fileEnv.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN ?? fileEnv.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL is not set, and .env.local has no value for it.",
  );
}

/** The host only — never the token. */
const target = url.startsWith("file:") ? url : url.split("?")[0];

if (process.env.CONFIRM !== "drop-everything") {
  console.log(`\nThis would drop EVERY table in:\n\n  ${target}\n`);
  console.log("Nothing is recoverable afterwards. To go ahead:\n");
  console.log("  CONFIRM=drop-everything npm run db:reset\n");
  process.exit(1);
}

const client = createClient({
  url,
  authToken: url.startsWith("file:") ? undefined : authToken,
});

const tables = (
  await client.execute(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  )
).rows.map((row) => String(row.name));

if (tables.length === 0) {
  console.log(`\n${target} is already empty. Nothing to do.\n`);
  process.exit(0);
}

console.log(`\nTarget: ${target}`);
console.log(`Dropping ${tables.length} tables: ${tables.join(", ")}\n`);

function isForeignKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /FOREIGN KEY constraint failed/i.test(message);
}

/*
 * Turso enforces foreign keys, and `DROP TABLE` runs an implicit `DELETE FROM`
 * — so dropping a parent while a child still references its rows fails. Turning
 * the constraint off is not an option either: `PRAGMA foreign_keys` is a no-op
 * inside a transaction, which is the only place a pooled HTTP connection would
 * hold the setting long enough to matter.
 *
 * So drop what will drop, repeat, and let the order sort itself out. Each pass
 * frees the parents of whatever went in the pass before. This needs no map of
 * the schema, which matters here: the tables left behind by another application
 * are exactly the ones whose references are unknown.
 */
let remaining = tables;

while (remaining.length > 0) {
  const blocked: string[] = [];

  for (const table of remaining) {
    try {
      await client.execute(`DROP TABLE IF EXISTS "${table}"`);
      console.log(`  dropped ${table}`);
    } catch (error) {
      if (!isForeignKeyError(error)) throw error;
      blocked.push(table);
    }
  }

  if (blocked.length === remaining.length) {
    throw new Error(
      `Stuck: ${blocked.join(", ")} reference each other in a cycle, so no ` +
        `order of DROP TABLE will clear them. Empty them first — ` +
        `DELETE FROM each — and run this again.`,
    );
  }

  remaining = blocked;
}

const left = (
  await client.execute(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
).rows.map((row) => String(row.name));

console.log(`\nDone. Remaining: ${left.length === 0 ? "(none)" : left.join(", ")}`);
console.log(
  "The next request to the app rebuilds the schema from migration 001.\n",
);
