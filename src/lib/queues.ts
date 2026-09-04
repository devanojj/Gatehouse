import "server-only";

import { execute, executeCounting, insert, query, queryOne } from "./db";
import { slugifyOrgName } from "./slug";

export type Queue = {
  id: number;
  org_id: number;
  name: string;
  slug: string;
  /** SQLite has no boolean: 1 on exactly one queue per organization. */
  is_default: number;
  created_at: string;
};

export type QueueWithCount = Queue & { open_tickets: number };

/**
 * Queues sort defaults first, then alphabetically — the default is where
 * unrouted work lands, so it belongs at the top of every list that offers one.
 */
export async function listQueues(orgId: number): Promise<Queue[]> {
  return query<Queue>(
    `SELECT * FROM queues
      WHERE org_id = ?
      ORDER BY is_default DESC, name COLLATE NOCASE`,
    [orgId],
  );
}

export async function listQueuesWithCounts(
  orgId: number,
): Promise<QueueWithCount[]> {
  return query<QueueWithCount>(
    `SELECT q.*,
            (SELECT COUNT(*)
               FROM tickets t
              WHERE t.org_id = q.org_id
                AND t.queue_id = q.id
                AND t.status NOT IN ('resolved', 'closed')) AS open_tickets
       FROM queues q
      WHERE q.org_id = ?
      ORDER BY q.is_default DESC, q.name COLLATE NOCASE`,
    [orgId],
  );
}

export async function getQueue(
  orgId: number,
  queueId: number,
): Promise<Queue | null> {
  return queryOne<Queue>(`SELECT * FROM queues WHERE org_id = ? AND id = ?`, [
    orgId,
    queueId,
  ]);
}

export async function getDefaultQueue(orgId: number): Promise<Queue | null> {
  return queryOne<Queue>(
    `SELECT * FROM queues WHERE org_id = ? AND is_default = 1`,
    [orgId],
  );
}

/**
 * The queue a ticket goes to when nothing has chosen one.
 *
 * An organization without a default is a broken state rather than a normal one
 * — the migration gives every existing org a "General", and signup gives every
 * new one the same — so this recreates it instead of returning null and letting
 * a ticket be written with no queue.
 */
export async function ensureDefaultQueue(orgId: number): Promise<number> {
  const existing = await getDefaultQueue(orgId);
  if (existing) return existing.id;

  return createQueue(orgId, "General", { isDefault: true });
}

/**
 * Slugs are unique per organization, not globally: two tenants may both have a
 * "Billing". A collision inside one org takes a numeric suffix.
 */
async function availableSlug(orgId: number, name: string): Promise<string> {
  const base = slugifyOrgName(name);

  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await queryOne(
      `SELECT 1 FROM queues WHERE org_id = ? AND slug = ?`,
      [orgId, candidate],
    );
    if (!taken) return candidate;
  }
}

export async function createQueue(
  orgId: number,
  name: string,
  { isDefault = false }: { isDefault?: boolean } = {},
): Promise<number> {
  const slug = await availableSlug(orgId, name);

  return insert(
    `INSERT INTO queues (org_id, name, slug, is_default) VALUES (?, ?, ?, ?)`,
    [orgId, name, slug, isDefault ? 1 : 0],
  );
}

export async function renameQueue(
  orgId: number,
  queueId: number,
  name: string,
): Promise<void> {
  await execute(`UPDATE queues SET name = ? WHERE id = ? AND org_id = ?`, [
    name,
    queueId,
    orgId,
  ]);
}

/**
 * Clearing the old default before setting the new one keeps the partial unique
 * index satisfied at every point in between.
 */
export async function setDefaultQueue(
  orgId: number,
  queueId: number,
): Promise<boolean> {
  const exists = await getQueue(orgId, queueId);
  if (!exists) return false;

  await execute(`UPDATE queues SET is_default = 0 WHERE org_id = ?`, [orgId]);
  await execute(
    `UPDATE queues SET is_default = 1 WHERE id = ? AND org_id = ?`,
    [queueId, orgId],
  );

  return true;
}

/**
 * Deleting a queue moves its tickets to the default rather than orphaning them.
 * The default itself cannot be deleted — there would be nowhere for the moved
 * tickets, or the next inbound message, to go.
 */
export async function deleteQueue(
  orgId: number,
  queueId: number,
): Promise<{ deleted: boolean; movedTickets: number }> {
  const queue = await getQueue(orgId, queueId);
  if (!queue || queue.is_default === 1) {
    return { deleted: false, movedTickets: 0 };
  }

  const fallback = await ensureDefaultQueue(orgId);

  const movedTickets = await executeCounting(
    `UPDATE tickets SET queue_id = ? WHERE org_id = ? AND queue_id = ?`,
    [fallback, orgId, queueId],
  );

  await execute(`DELETE FROM queues WHERE id = ? AND org_id = ?`, [
    queueId,
    orgId,
  ]);

  return { deleted: true, movedTickets };
}
