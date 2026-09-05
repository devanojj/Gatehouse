import "server-only";

import { executeCounting, query, queryOne, TIMELINE_NOW } from "./db";

/**
 * Everything that happens to a ticket other than the conversation itself.
 * Comments carry what was said; this carries what was changed.
 */
export const EVENT_KINDS = [
  "created",
  "status_changed",
  "priority_changed",
  "assignee_changed",
  "queue_changed",
  "sla_breached",
  "sla_warning",
  "rule_applied",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return EVENT_KINDS.includes(value as EventKind);
}

export type TicketEvent = {
  id: number;
  org_id: number;
  ticket_id: number;
  actor_agent_id: number | null;
  actor_agent_name: string | null;
  kind: EventKind;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
};

/**
 * Records one change against a ticket.
 *
 * The insert selects the ticket rather than trusting the id: a ticket in
 * another tenant matches nothing, so a crossed id writes no row instead of
 * writing a row that points across the boundary. The return value says whether
 * it landed.
 *
 * Values are stored as the text the timeline should show — an assignee's name
 * rather than an agent id — because this is a historical record. Renaming an
 * agent tomorrow must not rewrite what happened yesterday.
 */
export async function recordEvent(
  orgId: number,
  ticketId: number,
  kind: EventKind,
  {
    actorAgentId = null,
    from = null,
    to = null,
  }: {
    actorAgentId?: number | null;
    from?: string | null;
    to?: string | null;
  } = {},
): Promise<boolean> {
  const rows = await executeCounting(
    `INSERT INTO ticket_events
       (org_id, ticket_id, actor_agent_id, kind, from_value, to_value, created_at)
     SELECT ?, t.id, (SELECT id FROM agents WHERE id = ? AND org_id = ?), ?, ?, ?,
            ${TIMELINE_NOW}
       FROM tickets t
      WHERE t.id = ? AND t.org_id = ?`,
    [orgId, actorAgentId, orgId, kind, from, to, ticketId, orgId],
  );

  return rows > 0;
}

/**
 * `ticket_events.org_id` is filtered directly rather than reached through a
 * join on `tickets`, for the same reason `comments.org_id` is.
 */
export async function listEvents(
  orgId: number,
  ticketId: number,
): Promise<TicketEvent[]> {
  return query<TicketEvent>(
    `SELECT e.*, a.name AS actor_agent_name
       FROM ticket_events e
       LEFT JOIN agents a
         ON a.id = e.actor_agent_id
        AND a.org_id = e.org_id
      WHERE e.org_id = ? AND e.ticket_id = ?
      ORDER BY e.created_at, e.id`,
    [orgId, ticketId],
  );
}

export type AuditEvent = TicketEvent & {
  ticket_subject: string | null;
};

export type AuditFilters = {
  actorAgentId?: number | null;
  kind?: EventKind | null;
  ticketId?: number | null;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
  offset?: number;
};

/**
 * Lists audit events across tickets within an organization, supporting
 * filtering by actor, event kind, ticket ID, and date range.
 */
export async function listAuditEvents(
  orgId: number,
  filters: AuditFilters = {},
): Promise<AuditEvent[]> {
  const conditions: string[] = ["e.org_id = ?"];
  const params: unknown[] = [orgId];

  if (filters.actorAgentId !== undefined && filters.actorAgentId !== null) {
    conditions.push("e.actor_agent_id = ?");
    params.push(filters.actorAgentId);
  }

  if (filters.kind) {
    conditions.push("e.kind = ?");
    params.push(filters.kind);
  }

  if (filters.ticketId) {
    conditions.push("e.ticket_id = ?");
    params.push(filters.ticketId);
  }

  if (filters.fromDate) {
    conditions.push("e.created_at >= ?");
    params.push(filters.fromDate);
  }

  if (filters.toDate) {
    conditions.push("e.created_at <= ?");
    params.push(filters.toDate);
  }

  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);
  params.push(limit, offset);

  return query<AuditEvent>(
    `SELECT e.*, a.name AS actor_agent_name, t.subject AS ticket_subject
       FROM ticket_events e
       LEFT JOIN agents a
         ON a.id = e.actor_agent_id
        AND a.org_id = e.org_id
       LEFT JOIN tickets t
         ON t.id = e.ticket_id
        AND t.org_id = e.org_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ? OFFSET ?`,
    params,
  );
}

/**
 * Counts total matching audit events for pagination.
 */
export async function countAuditEvents(
  orgId: number,
  filters: Omit<AuditFilters, "limit" | "offset"> = {},
): Promise<number> {
  const conditions: string[] = ["e.org_id = ?"];
  const params: unknown[] = [orgId];

  if (filters.actorAgentId !== undefined && filters.actorAgentId !== null) {
    conditions.push("e.actor_agent_id = ?");
    params.push(filters.actorAgentId);
  }

  if (filters.kind) {
    conditions.push("e.kind = ?");
    params.push(filters.kind);
  }

  if (filters.ticketId) {
    conditions.push("e.ticket_id = ?");
    params.push(filters.ticketId);
  }

  if (filters.fromDate) {
    conditions.push("e.created_at >= ?");
    params.push(filters.fromDate);
  }

  if (filters.toDate) {
    conditions.push("e.created_at <= ?");
    params.push(filters.toDate);
  }

  const row = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total
       FROM ticket_events e
      WHERE ${conditions.join(" AND ")}`,
    params,
  );

  return Number(row?.total ?? 0);
}

