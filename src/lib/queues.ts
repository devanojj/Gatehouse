import "server-only";

import { batchWrite, execute, insert, query, queryOne } from "./db";
import { ticketEventStatement } from "./ticket-events";

export const QUEUE_NAME_MAX = 60;
export const QUEUE_DESCRIPTION_MAX = 200;

export type Queue = {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  created_at: string;
  /** Only present on the settings list. */
  member_count?: number;
  open_count?: number;
};

export type QueueMember = {
  agent_id: number;
  name: string;
  email: string;
  role: string;
};

/**
 * Queues are tenant-owned like everything else: `orgId` comes first and appears
 * in the WHERE clause of every statement, including the subqueries that resolve
 * a member or a ticket's queue.
 */
export async function listQueues(orgId: number): Promise<Queue[]> {
  return query<Queue>(
    `SELECT q.*,
            (SELECT COUNT(*) FROM queue_members m
              WHERE m.org_id = q.org_id AND m.queue_id = q.id) AS member_count,
            (SELECT COUNT(*) FROM tickets t
              WHERE t.org_id = q.org_id
                AND t.queue_id = q.id
                AND t.status IN ('open', 'pending', 'in-progress')) AS open_count
       FROM queues q
      WHERE q.org_id = ?
      ORDER BY q.name COLLATE NOCASE`,
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

/** The queues an agent has been added to, for their own saved views. */
export async function listQueuesForAgent(
  orgId: number,
  agentId: number,
): Promise<Queue[]> {
  return query<Queue>(
    `SELECT q.*,
            (SELECT COUNT(*) FROM tickets t
              WHERE t.org_id = q.org_id
                AND t.queue_id = q.id
                AND t.status IN ('open', 'pending', 'in-progress')) AS open_count
       FROM queues q
       JOIN queue_members m
         ON m.queue_id = q.id
        AND m.org_id = q.org_id
      WHERE q.org_id = ?
        AND m.agent_id = ?
      ORDER BY q.name COLLATE NOCASE`,
    [orgId, agentId],
  );
}

export async function findQueueByName(
  orgId: number,
  name: string,
): Promise<Queue | null> {
  return queryOne<Queue>(
    `SELECT * FROM queues WHERE org_id = ? AND name = ? COLLATE NOCASE`,
    [orgId, name],
  );
}

export async function createQueue(
  orgId: number,
  name: string,
  description: string | null,
): Promise<number> {
  return insert(
    `INSERT INTO queues (org_id, name, description) VALUES (?, ?, ?)`,
    [orgId, name, description],
  );
}

export async function updateQueue(
  orgId: number,
  queueId: number,
  name: string,
  description: string | null,
): Promise<void> {
  await execute(
    `UPDATE queues SET name = ?, description = ? WHERE id = ? AND org_id = ?`,
    [name, description, queueId, orgId],
  );
}

/**
 * Deletes a queue and lets go of everything pointing at it, in one transaction:
 * tickets fall back to no queue rather than referencing a row that is gone, and
 * the membership rows go with it.
 */
export async function deleteQueue(
  orgId: number,
  queueId: number,
): Promise<void> {
  await batchWrite([
    {
      sql: `UPDATE tickets SET queue_id = NULL, updated_at = datetime('now')
             WHERE org_id = ? AND queue_id = ?`,
      args: [orgId, queueId],
    },
    {
      sql: `DELETE FROM queue_members WHERE org_id = ? AND queue_id = ?`,
      args: [orgId, queueId],
    },
    {
      sql: `DELETE FROM queues WHERE org_id = ? AND id = ?`,
      args: [orgId, queueId],
    },
  ]);
}

// ------------------------------------------------------------------ members

export async function listQueueMembers(
  orgId: number,
  queueId: number,
): Promise<QueueMember[]> {
  return query<QueueMember>(
    `SELECT a.id AS agent_id, a.name AS name, a.email AS email, a.role AS role
       FROM queue_members m
       JOIN agents a
         ON a.id = m.agent_id
        AND a.org_id = m.org_id
      WHERE m.org_id = ?
        AND m.queue_id = ?
      ORDER BY a.name COLLATE NOCASE`,
    [orgId, queueId],
  );
}

/**
 * Adds an agent to a queue.
 *
 * The row is built by a SELECT that joins the queue to the agent on a shared
 * `org_id`, so a member is only ever created when both sides are in `orgId` —
 * an agent id from another tenant inserts nothing at all.
 */
export async function addQueueMember(
  orgId: number,
  queueId: number,
  agentId: number,
): Promise<void> {
  await execute(
    `INSERT OR IGNORE INTO queue_members (org_id, queue_id, agent_id)
     SELECT q.org_id, q.id, a.id
       FROM queues q
       JOIN agents a
         ON a.org_id = q.org_id
      WHERE q.id = ?
        AND q.org_id = ?
        AND a.id = ?`,
    [queueId, orgId, agentId],
  );
}

export async function removeQueueMember(
  orgId: number,
  queueId: number,
  agentId: number,
): Promise<void> {
  await execute(
    `DELETE FROM queue_members
      WHERE org_id = ? AND queue_id = ? AND agent_id = ?`,
    [orgId, queueId, agentId],
  );
}

// ------------------------------------------------------------ ticket routing

/**
 * Moves a ticket into a queue, or out of every queue when `queueId` is null.
 *
 * The queue is resolved by a subquery scoped to the same org — the same shape
 * `updateAssignee` uses — so a foreign queue id lands as NULL instead of
 * routing a ticket into another tenant's queue. The event resolves both names
 * the same way, and runs first so it can read the queue being left.
 */
export async function setTicketQueue(
  orgId: number,
  ticketId: number,
  queueId: number | null,
  context: { agentId: number | null },
): Promise<void> {
  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: context.agentId,
      type: "queue",
      oldValue: { currentQueue: true },
      newValue: { queue: queueId },
    }),
    {
      sql: `UPDATE tickets
               SET queue_id = (
                     SELECT id FROM queues WHERE id = ? AND org_id = ?
                   ),
                   updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
      args: [queueId, orgId, ticketId, orgId],
    },
  ]);
}
