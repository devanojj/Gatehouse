import "server-only";

import { executeCounting, query } from "./db";

/**
 * Everything that happens to a ticket other than the conversation itself.
 * Comments carry what was said; this carries what was changed.
 */
export const EVENT_KINDS = [
  "created",
  "status_changed",
  "priority_changed",
  "assignee_changed",
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
       (org_id, ticket_id, actor_agent_id, kind, from_value, to_value)
     SELECT ?, t.id, (SELECT id FROM agents WHERE id = ? AND org_id = ?), ?, ?, ?
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
