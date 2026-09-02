import "server-only";

import { execute, insert, query, queryOne } from "./db";

export const STATUSES = ["open", "in-progress", "closed"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}

export function isPriority(value: unknown): value is Priority {
  return PRIORITIES.includes(value as Priority);
}

export type Ticket = {
  id: number;
  org_id: number;
  subject: string;
  description: string | null;
  status: Status;
  priority: Priority;
  requester_email: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_TICKET = `
  SELECT t.*, a.name AS assigned_agent_name
    FROM tickets t
    LEFT JOIN agents a
      ON a.id = t.assigned_agent_id
     AND a.org_id = t.org_id
`;

/**
 * Every function in this module takes `orgId` as its first argument and puts it
 * in the WHERE clause. A ticket id on its own is never enough to reach a row.
 */
export async function listTickets(
  orgId: number,
  status?: Status,
): Promise<Ticket[]> {
  if (status) {
    return query<Ticket>(
      `${SELECT_TICKET} WHERE t.org_id = ? AND t.status = ? ORDER BY t.created_at DESC`,
      [orgId, status],
    );
  }
  return query<Ticket>(
    `${SELECT_TICKET} WHERE t.org_id = ? ORDER BY t.created_at DESC`,
    [orgId],
  );
}

export async function countTicketsByStatus(
  orgId: number,
): Promise<Record<string, number>> {
  const rows = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM tickets WHERE org_id = ? GROUP BY status`,
    [orgId],
  );

  const counts: Record<string, number> = { all: 0 };
  for (const status of STATUSES) counts[status] = 0;

  for (const row of rows) {
    counts[row.status] = Number(row.n);
    counts.all += Number(row.n);
  }
  return counts;
}

export async function getTicket(
  orgId: number,
  ticketId: number,
): Promise<Ticket | null> {
  return queryOne<Ticket>(`${SELECT_TICKET} WHERE t.org_id = ? AND t.id = ?`, [
    orgId,
    ticketId,
  ]);
}

export async function createTicket(
  orgId: number,
  fields: {
    subject: string;
    description: string | null;
    priority: Priority;
    requesterEmail: string | null;
    sourceMessageId?: string | null;
  },
): Promise<number> {
  return insert(
    `INSERT INTO tickets
       (org_id, subject, description, priority, requester_email, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      orgId,
      fields.subject,
      fields.description,
      fields.priority,
      fields.requesterEmail,
      fields.sourceMessageId ?? null,
    ],
  );
}

/**
 * The fallback for a reply whose subject lost the `[Ticket #N]` marker: the
 * sender's most recent ticket that is still being worked on. Closed tickets are
 * excluded so a months-old thread is not reopened by a new question.
 */
export async function findOpenTicketByRequester(
  orgId: number,
  requesterEmail: string,
): Promise<Ticket | null> {
  return queryOne<Ticket>(
    `${SELECT_TICKET}
      WHERE t.org_id = ?
        AND t.requester_email = ?
        AND t.status IN ('open', 'in-progress')
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orgId, requesterEmail],
  );
}

export async function updateStatus(
  orgId: number,
  ticketId: number,
  status: Status,
): Promise<void> {
  await execute(
    `UPDATE tickets SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [status, ticketId, orgId],
  );
}

export async function updatePriority(
  orgId: number,
  ticketId: number,
  priority: Priority,
): Promise<void> {
  await execute(
    `UPDATE tickets SET priority = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [priority, ticketId, orgId],
  );
}

/**
 * The assignee subquery is scoped to the same org, so an agent id belonging to
 * another tenant resolves to NULL rather than assigning across the boundary.
 */
export async function updateAssignee(
  orgId: number,
  ticketId: number,
  agentId: number | null,
): Promise<void> {
  await execute(
    `UPDATE tickets
        SET assigned_agent_id = (
              SELECT id FROM agents WHERE id = ? AND org_id = ?
            ),
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [agentId, orgId, ticketId, orgId],
  );
}

export async function touchTicket(
  orgId: number,
  ticketId: number,
): Promise<void> {
  await execute(
    `UPDATE tickets SET updated_at = datetime('now') WHERE id = ? AND org_id = ?`,
    [ticketId, orgId],
  );
}
