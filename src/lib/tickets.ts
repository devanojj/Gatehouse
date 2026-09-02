import "server-only";

import { batchWrite, execute, insert, query, queryOne } from "./db";
import { ticketEventStatement } from "./ticket-events";

export const STATUSES = [
  "open",
  "pending",
  "in-progress",
  "resolved",
  "closed",
] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;

/**
 * Statuses that still need someone's attention. `resolved` is an answer waiting
 * to be accepted rather than work in flight, and `closed` is done.
 */
export const ACTIVE_STATUSES = ["open", "pending", "in-progress"] as const;

/**
 * A customer reply to a ticket in one of these puts it back in the queue.
 * `closed` is deliberately absent — see `fileMessage` in `inbound.ts`.
 */
export const REOPEN_STATUSES = ["pending", "resolved"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}

export function isPriority(value: unknown): value is Priority {
  return PRIORITIES.includes(value as Priority);
}

export function reopensOnReply(status: string): boolean {
  return (REOPEN_STATUSES as readonly string[]).includes(status);
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
  created_at: string;
  updated_at: string;
};

/** Both joins repeat `org_id` so a mismatched row can never supply a name. */
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

/** Nothing on the list page ever needs more rows than this. */
export const TICKET_LIST_LIMIT = 200;

export type TicketFilter = {
  status?: Status;
  /** Only tickets still being worked: open, pending, in-progress. */
  activeOnly?: boolean;
  queueId?: number;
  /** Tickets in no queue at all. */
  noQueue?: boolean;
  assignedAgentId?: number;
  unassigned?: boolean;
  priority?: Priority;
  /** Free text: ticket number, subject, requester, description, or a comment. */
  search?: string;
  limit?: number;
};

/**
 * Every function in this module takes `orgId` as its first argument and puts it
 * in the WHERE clause. A ticket id on its own is never enough to reach a row.
 *
 * The filters compose: each one appends a condition and its own placeholders,
 * so a caller cannot widen the org check by passing an unusual combination.
 */
export async function listTickets(
  orgId: number,
  filter: TicketFilter = {},
): Promise<Ticket[]> {
  const conditions = ["t.org_id = ?"];
  const args: unknown[] = [orgId];

  if (filter.status) {
    conditions.push("t.status = ?");
    args.push(filter.status);
  }

  if (filter.activeOnly) {
    conditions.push(`t.status IN (${placeholders(ACTIVE_STATUSES.length)})`);
    args.push(...ACTIVE_STATUSES);
  }

  if (filter.queueId !== undefined) {
    conditions.push("t.queue_id = ?");
    args.push(filter.queueId);
  }

  if (filter.noQueue) {
    conditions.push("t.queue_id IS NULL");
  }

  if (filter.assignedAgentId !== undefined) {
    conditions.push("t.assigned_agent_id = ?");
    args.push(filter.assignedAgentId);
  }

  if (filter.unassigned) {
    conditions.push("t.assigned_agent_id IS NULL");
  }

  if (filter.priority) {
    conditions.push("t.priority = ?");
    args.push(filter.priority);
  }

  const search = filter.search?.trim();
  if (search) {
    const term = likeTerm(search);
    const clauses = [
      "t.subject LIKE ? ESCAPE '\\'",
      "t.description LIKE ? ESCAPE '\\'",
      "t.requester_email LIKE ? ESCAPE '\\'",
      `EXISTS (SELECT 1
                 FROM comments c
                WHERE c.org_id = ?
                  AND c.org_id = t.org_id
                  AND c.ticket_id = t.id
                  AND c.body LIKE ? ESCAPE '\\')`,
    ];
    args.push(term, term, term, orgId, term);

    // "#42" and "42" both mean the ticket number, which is the fastest way for
    // an agent to jump to a ticket they already know.
    const number = ticketNumberFromSearch(search);
    if (number !== null) {
      clauses.push("t.id = ?");
      args.push(number);
    }

    conditions.push(`(${clauses.join(" OR ")})`);
  }

  args.push(Math.min(filter.limit ?? TICKET_LIST_LIMIT, TICKET_LIST_LIMIT));

  return query<Ticket>(
    `${SELECT_TICKET}
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ?`,
    args,
  );
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

/**
 * Wraps a search term for LIKE, neutralizing the wildcards a user can type. A
 * bare `%` would otherwise match every ticket in the organization.
 */
function likeTerm(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function ticketNumberFromSearch(raw: string): number | null {
  const digits = raw.trim().replace(/^#/, "");
  if (!/^\d{1,9}$/.test(digits)) return null;

  const id = Number(digits);
  return Number.isInteger(id) && id > 0 ? id : null;
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

export type ViewCounts = {
  mine: number;
  unassigned: number;
  waiting: number;
  urgent: number;
};

/**
 * The badge numbers on the saved views. One pass over the org's tickets rather
 * than four queries, and `agentId` comes from the session like everything else.
 */
export async function countTicketViews(
  orgId: number,
  agentId: number,
): Promise<ViewCounts> {
  const active = placeholders(ACTIVE_STATUSES.length);

  const row = await queryOne<{
    mine: number;
    unassigned: number;
    waiting: number;
    urgent: number;
  }>(
    `SELECT
       SUM(CASE WHEN status IN (${active}) AND assigned_agent_id = ? THEN 1 ELSE 0 END) AS mine,
       SUM(CASE WHEN status IN (${active}) AND assigned_agent_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN status IN (${active}) AND priority = 'high' THEN 1 ELSE 0 END) AS urgent
     FROM tickets
    WHERE org_id = ?`,
    [...ACTIVE_STATUSES, agentId, ...ACTIVE_STATUSES, ...ACTIVE_STATUSES, orgId],
  );

  return {
    mine: Number(row?.mine ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    waiting: Number(row?.waiting ?? 0),
    urgent: Number(row?.urgent ?? 0),
  };
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
    queueId?: number | null;
    sourceMessageId?: string | null;
  },
  actor: { agentId: number | null; label?: string | null } = { agentId: null },
): Promise<number> {
  const ticketId = await insert(
    `INSERT INTO tickets
       (org_id, subject, description, priority, requester_email, queue_id, source_message_id)
     VALUES (?, ?, ?, ?, ?,
             (SELECT id FROM queues WHERE id = ? AND org_id = ?),
             ?)`,
    [
      orgId,
      fields.subject,
      fields.description,
      fields.priority,
      fields.requesterEmail,
      fields.queueId ?? null,
      orgId,
      fields.sourceMessageId ?? null,
    ],
  );

  // The id only exists once the row does, so this is the one event that cannot
  // ride in the same transaction. It is still org-guarded in SQL.
  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: actor.agentId,
      type: "created",
      newValue: { text: actor.label ?? null },
    }),
  ]);

  return ticketId;
}

/**
 * The fallback for a reply whose subject lost the `[Ticket #N]` marker: the
 * sender's most recent ticket that has not been closed. A closed thread is left
 * alone so a months-old conversation is not resurrected by a new question.
 */
export async function findOpenTicketByRequester(
  orgId: number,
  requesterEmail: string,
): Promise<Ticket | null> {
  return queryOne<Ticket>(
    `${SELECT_TICKET}
      WHERE t.org_id = ?
        AND t.requester_email = ?
        AND t.status <> 'closed'
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orgId, requesterEmail],
  );
}

export type Actor = { agentId: number | null };

export async function updateStatus(
  orgId: number,
  ticketId: number,
  status: Status,
  context: Actor & { previous: Status },
): Promise<void> {
  if (context.previous === status) return;

  // The event goes first so it can read the status the ticket is leaving
  // straight off the row, rather than trusting the caller for it.
  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: context.agentId,
      type: "status",
      oldValue: { ticketColumn: "status" },
      newValue: { text: status },
    }),
    {
      sql: `UPDATE tickets SET status = ?, updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
      args: [status, ticketId, orgId],
    },
  ]);
}

/**
 * Puts a ticket back in front of an agent because its requester wrote again.
 * Called by the mail fetcher, so the event has no acting agent.
 */
export async function reopenTicket(
  orgId: number,
  ticketId: number,
): Promise<void> {
  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: null,
      type: "reopened",
      oldValue: { ticketColumn: "status" },
      newValue: { text: "open" },
    }),
    {
      sql: `UPDATE tickets SET status = 'open', updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
      args: [ticketId, orgId],
    },
  ]);
}

export async function updatePriority(
  orgId: number,
  ticketId: number,
  priority: Priority,
  context: Actor & { previous: Priority },
): Promise<void> {
  if (context.previous === priority) return;

  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: context.agentId,
      type: "priority",
      oldValue: { ticketColumn: "priority" },
      newValue: { text: priority },
    }),
    {
      sql: `UPDATE tickets SET priority = ?, updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
      args: [priority, ticketId, orgId],
    },
  ]);
}

/**
 * The assignee subquery is scoped to the same org, so an agent id belonging to
 * another tenant resolves to NULL rather than assigning across the boundary —
 * and the event resolves the same two names the same way, so the timeline says
 * what actually happened rather than what was asked for.
 */
export async function updateAssignee(
  orgId: number,
  ticketId: number,
  agentId: number | null,
  context: Actor & { claimed?: boolean },
): Promise<void> {
  await batchWrite([
    ticketEventStatement(orgId, ticketId, {
      agentId: context.agentId,
      type: context.claimed ? "claimed" : "assignee",
      oldValue: { currentAgent: true },
      newValue: { agent: agentId },
    }),
    {
      sql: `UPDATE tickets
               SET assigned_agent_id = (
                     SELECT id FROM agents WHERE id = ? AND org_id = ?
                   ),
                   updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
      args: [agentId, orgId, ticketId, orgId],
    },
  ]);
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
