import "server-only";

import { execute, executeCounting, insert, query, queryOne } from "./db";
import { recordEvent } from "./events";

/**
 * The ticket lifecycle, in the order it is worked. `closed` is the end of the
 * line; `resolved` is the state a customer reply can still come back from.
 */
export const STATUSES = [
  "open",
  "in_progress",
  "pending_customer",
  "resolved",
  "closed",
] as const;

/** Statuses that mean somebody is still expected to do something. */
export const ACTIVE_STATUSES = [
  "open",
  "in_progress",
  "pending_customer",
] as const;

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
  /** Set when the ticket first reaches `resolved` or `closed`; cleared on reopen. */
  resolved_at: string | null;
  /** When an agent first replied publicly. Never overwritten. */
  first_response_at: string | null;
  created_at: string;
  updated_at: string;
};

/** For inlining into SQL — the values come from ACTIVE_STATUSES, never a caller. */
const ACTIVE_STATUS_LIST = ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ");

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

/**
 * The opening event is written here rather than by the caller, so a ticket
 * cannot reach the timeline without one — whether it came from the agent form,
 * inbound mail, or anywhere added later. `actorAgentId` is null for a ticket
 * the client raised.
 */
export async function createTicket(
  orgId: number,
  fields: {
    subject: string;
    description: string | null;
    priority: Priority;
    requesterEmail: string | null;
    sourceMessageId?: string | null;
    actorAgentId?: number | null;
  },
): Promise<number> {
  const ticketId = await insert(
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

  await recordEvent(orgId, ticketId, "created", {
    actorAgentId: fields.actorAgentId ?? null,
  });

  return ticketId;
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
        AND t.status IN (${ACTIVE_STATUS_LIST})
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orgId, requesterEmail],
  );
}

/**
 * `resolved_at` is maintained here rather than by the caller so it cannot drift
 * from the status. Reaching `resolved` or `closed` stamps it once — a ticket
 * closed after being resolved keeps the earlier time — and moving back to any
 * active status clears it, so a reopened ticket is not counted as resolved.
 */
export async function updateStatus(
  orgId: number,
  ticketId: number,
  status: Status,
): Promise<void> {
  await execute(
    `UPDATE tickets
        SET status = ?,
            resolved_at = CASE
              WHEN ? IN ('resolved', 'closed')
                THEN COALESCE(resolved_at, datetime('now'))
              ELSE NULL
            END,
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [status, status, ticketId, orgId],
  );
}

/**
 * Stamps the first public reply. The `IS NULL` guard is in the statement, not
 * in a read beforehand, so two agents replying at once still record one first
 * response. Returns whether this call was the one that set it.
 */
export async function markFirstResponse(
  orgId: number,
  ticketId: number,
): Promise<boolean> {
  const rows = await executeCounting(
    `UPDATE tickets SET first_response_at = datetime('now')
      WHERE id = ? AND org_id = ? AND first_response_at IS NULL`,
    [ticketId, orgId],
  );

  return rows > 0;
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
