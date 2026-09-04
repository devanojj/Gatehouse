import "server-only";

import { findOrCreateCustomer } from "./customers";
import { execute, executeCounting, insert, query, queryOne } from "./db";
import { recordEvent } from "./events";
import { ensureDefaultQueue } from "./queues";

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

/**
 * Statuses a client's reply can still join. `resolved` is included — a reply
 * to something marked resolved is exactly the case where the fix did not work,
 * and it reopens the ticket. `closed` is not: a reply there starts a new one.
 */
export const REPLYABLE_STATUSES = [...ACTIVE_STATUSES, "resolved"] as const;

export const PRIORITIES = ["low", "medium", "high"] as const;

/**
 * Which status may follow which. Everything active can reach any other active
 * status or an end state; `closed` is the exception — the only way out is back
 * to `open`, and only an owner may do it (enforced in the action, which is
 * where the role is known).
 */
const TRANSITIONS: Record<Status, readonly Status[]> = {
  open: ["in_progress", "pending_customer", "resolved", "closed"],
  in_progress: ["open", "pending_customer", "resolved", "closed"],
  pending_customer: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "in_progress", "pending_customer", "closed"],
  closed: ["open"],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The statuses a ticket in this state can actually be moved to, for a select. */
export function allowedTransitions(from: Status): readonly Status[] {
  return TRANSITIONS[from];
}

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
  queue_id: number | null;
  queue_name: string | null;
  source_message_id: string | null;
  /** Set when the ticket first reaches `resolved` or `closed`; cleared on reopen. */
  resolved_at: string | null;
  /** When an agent first replied publicly. Never overwritten. */
  first_response_at: string | null;
  requester_customer_id: number | null;
  public_token: string | null;
  public_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

/** For inlining into SQL — the values come from the constant, never a caller. */
const REPLYABLE_STATUS_LIST = REPLYABLE_STATUSES.map((s) => `'${s}'`).join(", ");

const SELECT_TICKET = `
  SELECT t.*, a.name AS assigned_agent_name, q.name AS queue_name
    FROM tickets t
    LEFT JOIN agents a
      ON a.id = t.assigned_agent_id
     AND a.org_id = t.org_id
    LEFT JOIN queues q
      ON q.id = t.queue_id
     AND q.org_id = t.org_id
`;

/**
 * Every function in this module takes `orgId` as its first argument and puts it
 * in the WHERE clause. A ticket id on its own is never enough to reach a row.
 */
export type TicketFilters = {
  status?: Status;
  queueId?: number;
  assigneeId?: number;
  /** Tickets nobody has picked up. Takes precedence over `assigneeId`. */
  unassigned?: boolean;
};

/**
 * Filters are optional and additive; `orgId` is not. Each one is a bound
 * parameter appended to the same org-scoped WHERE, so no combination of them
 * can widen the query past the tenant.
 */
export async function listTickets(
  orgId: number,
  filters: TicketFilters = {},
): Promise<Ticket[]> {
  const clauses = ["t.org_id = ?"];
  const args: unknown[] = [orgId];

  if (filters.status) {
    clauses.push("t.status = ?");
    args.push(filters.status);
  }

  if (filters.queueId) {
    clauses.push("t.queue_id = ?");
    args.push(filters.queueId);
  }

  if (filters.unassigned) {
    clauses.push("t.assigned_agent_id IS NULL");
  } else if (filters.assigneeId) {
    clauses.push("t.assigned_agent_id = ?");
    args.push(filters.assigneeId);
  }

  return query<Ticket>(
    `${SELECT_TICKET} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at DESC`,
    args,
  );
}

/**
 * Counts for the status tabs. Takes the same queue filter the list does, so a
 * tab never promises rows the current view would not show.
 */
export async function countTicketsByStatus(
  orgId: number,
  queueId?: number,
): Promise<Record<string, number>> {
  const rows = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n
       FROM tickets
      WHERE org_id = ?${queueId ? " AND queue_id = ?" : ""}
      GROUP BY status`,
    queueId ? [orgId, queueId] : [orgId],
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

/** Where a ticket came from, recorded on its opening event. */
export type TicketSource = "agent" | "email" | "portal";

/**
 * The opening event is written here rather than by the caller, so a ticket
 * cannot reach the timeline without one — whether it came from the agent form,
 * inbound mail, or the portal. `actorAgentId` is null for a ticket the client
 * raised themselves.
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
    /** Resolved against this org; anything else falls back to the default. */
    queueId?: number | null;
    requesterCustomerId?: number | null;
    /** The one-off confirmation link handed back at submission. */
    publicToken?: string | null;
    publicTokenExpiresAt?: string | null;
    source?: TicketSource;
  },
): Promise<number> {
  // Every ticket lands in a queue, whether it came from the form, from mail, or
  // from anywhere added later. The subquery scopes a supplied id to this org, so
  // a foreign queue id becomes the default rather than a cross-tenant write.
  const fallbackQueueId = await ensureDefaultQueue(orgId);

  // A requester with an address is a customer of this org, however the ticket
  // arrived. Doing it here rather than in each caller is what lets someone who
  // has only ever emailed sign in to the portal and find their history: the row
  // exists, unverified, until they follow a link sent to that address.
  const requesterCustomerId =
    fields.requesterCustomerId ??
    (fields.requesterEmail
      ? (await findOrCreateCustomer(orgId, fields.requesterEmail, null)).id
      : null);

  const ticketId = await insert(
    `INSERT INTO tickets
       (org_id, subject, description, priority, requester_email,
        source_message_id, queue_id, requester_customer_id,
        public_token, public_token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?,
        COALESCE((SELECT id FROM queues WHERE id = ? AND org_id = ?), ?),
        (SELECT id FROM customers WHERE id = ? AND org_id = ?), ?, ?)`,
    [
      orgId,
      fields.subject,
      fields.description,
      fields.priority,
      fields.requesterEmail,
      fields.sourceMessageId ?? null,
      fields.queueId ?? null,
      orgId,
      fallbackQueueId,
      // Scoped like every other client-supplied id: a customer belonging to
      // another tenant resolves to NULL rather than linking across the boundary.
      requesterCustomerId,
      orgId,
      fields.publicToken ?? null,
      fields.publicTokenExpiresAt ?? null,
    ],
  );

  await recordEvent(orgId, ticketId, "created", {
    actorAgentId: fields.actorAgentId ?? null,
    to: fields.source ?? (fields.actorAgentId ? "agent" : "email"),
  });

  return ticketId;
}

/**
 * The fallback for a reply whose subject lost the `[Ticket #N]` marker: the
 * sender's most recent ticket that can still take one. Closed tickets are
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
        AND t.status IN (${REPLYABLE_STATUS_LIST})
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

/**
 * Takes an unassigned ticket. The `IS NULL` test is part of the UPDATE rather
 * than a read beforehand, so two agents pressing Claim at the same moment
 * cannot both win: the database decides, and the loser is told.
 */
export async function claimTicket(
  orgId: number,
  ticketId: number,
  agentId: number,
): Promise<boolean> {
  const rows = await executeCounting(
    `UPDATE tickets
        SET assigned_agent_id = (
              SELECT id FROM agents WHERE id = ? AND org_id = ?
            ),
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND assigned_agent_id IS NULL`,
    [agentId, orgId, ticketId, orgId],
  );

  return rows > 0;
}

/**
 * Moves a ticket between queues. Like `updateAssignee`, the target is resolved
 * through a subquery scoped to the same org — a queue id from another tenant
 * matches nothing, and the statement leaves the ticket where it was rather than
 * writing a queue the org does not own.
 */
export async function updateQueue(
  orgId: number,
  ticketId: number,
  queueId: number,
): Promise<boolean> {
  const rows = await executeCounting(
    `UPDATE tickets
        SET queue_id = (SELECT id FROM queues WHERE id = ? AND org_id = ?),
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
        AND EXISTS (SELECT 1 FROM queues WHERE id = ? AND org_id = ?)`,
    [queueId, orgId, ticketId, orgId, queueId, orgId],
  );

  return rows > 0;
}

/**
 * The tickets one verified customer raised with one organization.
 *
 * Both ids are required and both are in the WHERE clause: the org alone would
 * show a customer their tenant's whole queue, and the customer id alone would
 * cross tenants for an address known to two of them.
 */
/**
 * A reply from the client on a resolved ticket means it was not resolved.
 *
 * Shared by inbound mail and the portal so both behave the same way: closed is
 * never reopened automatically, and the event carries no agent because the
 * client is the actor.
 */
export async function reopenIfResolved(
  orgId: number,
  ticket: Pick<Ticket, "id" | "status">,
): Promise<boolean> {
  if (ticket.status !== "resolved") return false;

  await updateStatus(orgId, ticket.id, "open");
  await recordEvent(orgId, ticket.id, "status_changed", {
    from: "resolved",
    to: "open",
  });

  return true;
}

export async function listCustomerTickets(
  orgId: number,
  customerId: number,
  filters: { status?: Status; search?: string } = {},
): Promise<Ticket[]> {
  const clauses = ["t.org_id = ?", "t.requester_customer_id = ?"];
  const args: unknown[] = [orgId, customerId];

  if (filters.status) {
    clauses.push("t.status = ?");
    args.push(filters.status);
  }

  const search = filters.search?.trim();
  if (search) {
    // Reference number or words in the subject — what a customer actually has
    // to hand. The ticket body is not searched here; it is not theirs to grep.
    clauses.push("(t.subject LIKE ? OR CAST(t.id AS TEXT) = ?)");
    args.push(`%${search}%`, search.replace(/^#/, ""));
  }

  return query<Ticket>(
    `${SELECT_TICKET} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at DESC`,
    args,
  );
}

export async function getCustomerTicket(
  orgId: number,
  customerId: number,
  ticketId: number,
): Promise<Ticket | null> {
  return queryOne<Ticket>(
    `${SELECT_TICKET}
      WHERE t.org_id = ? AND t.requester_customer_id = ? AND t.id = ?`,
    [orgId, customerId, ticketId],
  );
}

/**
 * The unauthenticated confirmation link handed out at submission.
 *
 * Read-only, one ticket, and it expires — a support conversation should not sit
 * behind a URL forever. Anything past the confirmation itself requires signing
 * in, which is why this is the only query that takes no customer id.
 */
export async function getTicketByPublicToken(
  orgId: number,
  publicToken: string,
): Promise<Ticket | null> {
  return queryOne<Ticket>(
    `${SELECT_TICKET}
      WHERE t.org_id = ?
        AND t.public_token = ?
        AND t.public_token_expires_at > datetime('now')`,
    [orgId, publicToken],
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
