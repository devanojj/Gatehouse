import "server-only";

import { batchWrite, query, type Statement } from "./db";

/**
 * The activity timeline of a ticket.
 *
 * Rows are append-only: nothing in the app updates or deletes one, and every
 * write is produced by `ticketEventStatement` so it travels in the same
 * transaction as the mutation it describes.
 */
export const TICKET_EVENT_TYPES = [
  "created",
  "status",
  "priority",
  "assignee",
  "queue",
  "claimed",
  "reopened",
] as const;

export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export type TicketEvent = {
  id: number;
  org_id: number;
  ticket_id: number;
  agent_id: number | null;
  agent_name: string | null;
  type: TicketEventType;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

/**
 * What to record on either side of a change.
 *
 * Anything but `text` is resolved by the database, inside the ticket's own
 * organization, at the moment the event is written. That is what keeps a
 * timeline honest: a caller cannot label a rejected write as though it had
 * happened, and a name from another tenant resolves to NULL rather than being
 * printed on this org's ticket.
 *
 * The `current*` variants read the ticket as it is *before* the change, so an
 * event statement using one has to come first in its batch.
 */
export type EventValue =
  | { text: string | null }
  | { ticketColumn: "status" | "priority" }
  | { queue: number | null }
  | { agent: number | null }
  | { currentQueue: true }
  | { currentAgent: true };

export type TicketEventInput = {
  /** The agent who caused it, or null for the mail fetcher and other system work. */
  agentId: number | null;
  type: TicketEventType;
  oldValue?: EventValue;
  newValue?: EventValue;
};

/** Appends the placeholders one value needs and returns its SQL expression. */
function valueExpression(value: EventValue | undefined, args: unknown[]): string {
  if (!value) return "NULL";

  if ("text" in value) {
    args.push(value.text);
    return "?";
  }
  if ("ticketColumn" in value) {
    return `t.${value.ticketColumn}`;
  }
  if ("queue" in value) {
    args.push(value.queue);
    return `(SELECT q.name FROM queues q WHERE q.id = ? AND q.org_id = t.org_id)`;
  }
  if ("agent" in value) {
    args.push(value.agent);
    return `(SELECT a.name FROM agents a WHERE a.id = ? AND a.org_id = t.org_id)`;
  }
  if ("currentQueue" in value) {
    return `(SELECT q.name FROM queues q WHERE q.id = t.queue_id AND q.org_id = t.org_id)`;
  }
  return `(SELECT a.name FROM agents a WHERE a.id = t.assigned_agent_id AND a.org_id = t.org_id)`;
}

/**
 * The statement that records one event, for `batchWrite` alongside the write it
 * describes.
 *
 * Every id is resolved inside the SQL rather than trusted: the row is inserted
 * only if the ticket belongs to `orgId`, an agent id from another tenant lands
 * as NULL instead of attributing the change to a stranger, and the values on
 * either side are read back out of this org's own rows.
 */
export function ticketEventStatement(
  orgId: number,
  ticketId: number,
  event: TicketEventInput,
): Statement {
  const args: unknown[] = [event.agentId, event.type];

  const actor = `(SELECT a.id FROM agents a WHERE a.id = ? AND a.org_id = t.org_id)`;
  const oldValue = valueExpression(event.oldValue, args);
  const newValue = valueExpression(event.newValue, args);

  args.push(ticketId, orgId);

  return {
    sql: `INSERT INTO ticket_events
            (org_id, ticket_id, agent_id, type, old_value, new_value)
          SELECT t.org_id, t.id, ${actor}, ?, ${oldValue}, ${newValue}
            FROM tickets t
           WHERE t.id = ? AND t.org_id = ?`,
    args,
  };
}

/** For an event with no mutation of its own to ride along with. */
export async function recordTicketEvent(
  orgId: number,
  ticketId: number,
  event: TicketEventInput,
): Promise<void> {
  await batchWrite([ticketEventStatement(orgId, ticketId, event)]);
}

export async function listTicketEvents(
  orgId: number,
  ticketId: number,
): Promise<TicketEvent[]> {
  return query<TicketEvent>(
    `SELECT e.*, a.name AS agent_name
       FROM ticket_events e
       LEFT JOIN agents a
         ON a.id = e.agent_id
        AND a.org_id = e.org_id
      WHERE e.org_id = ? AND e.ticket_id = ?
      ORDER BY e.created_at, e.id`,
    [orgId, ticketId],
  );
}
