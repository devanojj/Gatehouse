import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Points the process at a throwaway SQLite file and cleans it up on exit.
 *
 * Must run before anything imports `src/lib/db.ts`: the client is created on
 * first use and memoized for the life of the process. Node's test runner gives
 * each test file its own process, so one scratch database per file is enough.
 */
export function scratchDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "gatehouse-test-"));
  const file = join(dir, "scratch.db");

  process.env.TURSO_DATABASE_URL = `file:${file}`;
  delete process.env.TURSO_AUTH_TOKEN;

  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

  return file;
}

/** A scratch file for a test that drives libSQL directly, without `db.ts`. */
export function scratchFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gatehouse-test-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return join(dir, name);
}
