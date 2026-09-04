import Link from "next/link";
import { notFound } from "next/navigation";

import {
  claimTicketAction,
  setAssigneeAction,
  setPriorityAction,
  setQueueAction,
  setStatusAction,
} from "@/app/actions/tickets";
import { listAgents } from "@/lib/agents";
import { requireSession } from "@/lib/auth";
import { listComments } from "@/lib/comments";
import { listEvents } from "@/lib/events";
import { formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";
import { listQueues } from "@/lib/queues";
import { allowedTransitions, getTicket, PRIORITIES } from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

import type { Comment, CommentType } from "@/lib/comments";
import type { TicketEvent } from "@/lib/events";

import { Composer } from "./Composer";
import { InlineSelect } from "./InlineSelect";

const COMMENT_LABELS: Record<CommentType, string> = {
  public: "Sent to client",
  internal: "Internal",
  inbound: "From client",
};

const COMMENT_TONE: Record<CommentType, string> = {
  public: "badge-teal",
  internal: "badge-amber",
  inbound: "badge-blue",
};

type TimelineEntry =
  | { at: string; seq: number; kind: "comment"; comment: Comment }
  | { at: string; seq: number; kind: "event"; event: TicketEvent };

/**
 * Comments and events are two tables with one chronology, timestamped to the
 * millisecond so they interleave truthfully. On an exact tie — or on rows
 * written before millisecond timestamps — a comment reads before the events
 * around it, since a change is usually a response to something said. Ids only
 * break ties within one table, never across two.
 */
function buildTimeline(
  comments: Comment[],
  events: TicketEvent[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...comments.map((comment) => ({
      at: comment.created_at,
      seq: comment.id,
      kind: "comment" as const,
      comment,
    })),
    ...events.map((event) => ({
      at: event.created_at,
      seq: event.id,
      kind: "event" as const,
      event,
    })),
  ];

  const rank = (entry: TimelineEntry) => (entry.kind === "comment" ? 0 : 1);

  return entries.sort((a, b) => {
    if (a.at !== b.at) return a.at.localeCompare(b.at);
    if (a.kind !== b.kind) return rank(a) - rank(b);
    return a.seq - b.seq;
  });
}

/** Past tense, subject first — the timeline reads as a list of things that happened. */
function describeEvent(event: TicketEvent): string {
  const who = event.actor_agent_name ?? "The client";

  switch (event.kind) {
    case "created":
      return event.actor_agent_name
        ? `${who} opened this ticket`
        : "Opened from an inbound email";
    case "status_changed":
      return `${who} changed status from ${label(STATUS_LABELS, event.from_value)} to ${label(STATUS_LABELS, event.to_value)}`;
    case "priority_changed":
      return `${who} changed priority from ${label(PRIORITY_LABELS, event.from_value)} to ${label(PRIORITY_LABELS, event.to_value)}`;
    case "assignee_changed":
      return `${who} changed the assignee from ${event.from_value} to ${event.to_value}`;
    case "queue_changed":
      return `${who} moved this ticket from ${event.from_value} to ${event.to_value}`;
  }
}

function label(labels: Record<string, string>, value: string | null): string {
  if (!value) return "—";
  return labels[value] ?? value;
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();

  // Scoped to the session's org, so another tenant's ticket id is a 404 here
  // rather than a leak.
  const ticket = await getTicket(session.orgId, ticketId);
  if (!ticket) notFound();

  const [comments, events, agents, queues] = await Promise.all([
    listComments(session.orgId, ticketId),
    listEvents(session.orgId, ticketId),
    listAgents(session.orgId),
    listQueues(session.orgId),
  ]);

  const timeline = buildTimeline(comments, events);

  // A closed ticket is read-only. An owner can reopen it; nobody can edit it in
  // place. The server enforces this too — this is what stops the controls from
  // offering something that would only throw.
  const locked = ticket.status === "closed";

  // Only the moves the ticket can actually make from where it is now.
  const statusOptions = locked
    ? session.role === "owner"
      ? (["closed", "open"] as const)
      : (["closed"] as const)
    : [ticket.status, ...allowedTransitions(ticket.status)];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/tickets">Tickets</Link> / #{ticket.id}
          </p>
          <h1>{ticket.subject}</h1>
        </div>
      </div>

      <div className="ticket-layout">
        <div>
          <div className="card card-pad">
            <div className="section-title">Description</div>
            {ticket.description ? (
              <p className="ticket-description">{ticket.description}</p>
            ) : (
              <p className="muted">No description was given.</p>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title">
              Activity
              {comments.length > 0
                ? ` · ${comments.length} ${comments.length === 1 ? "message" : "messages"}`
                : ""}
            </div>

            {timeline.length === 0 ? (
              <p className="muted">
                Nothing here yet. Reply to the client or leave an internal note.
              </p>
            ) : (
              <div className="thread">
                {timeline.map((entry) =>
                  entry.kind === "comment" ? (
                    <article
                      key={`c${entry.comment.id}`}
                      className={`comment comment-${entry.comment.type}`}
                    >
                      <div className="comment-head">
                        <span className="comment-author">
                          {entry.comment.type === "inbound"
                            ? (entry.comment.author_email ?? "Client")
                            : (entry.comment.agent_name ?? "Unknown")}
                        </span>
                        <span className={`badge ${COMMENT_TONE[entry.comment.type]}`}>
                          {COMMENT_LABELS[entry.comment.type]}
                        </span>
                        <span className="comment-time">
                          {formatDateTime(entry.comment.created_at)}
                        </span>
                      </div>
                      <p className="comment-body">{entry.comment.body}</p>
                    </article>
                  ) : (
                    <p className="event" key={`e${entry.event.id}`}>
                      <span>{describeEvent(entry.event)}</span>
                      <span className="event-time">
                        {formatDateTime(entry.event.created_at)}
                      </span>
                    </p>
                  ),
                )}
              </div>
            )}
          </div>

          {locked ? (
            <p className="locked-banner">
              <strong>This ticket is closed.</strong>
              <span>
                {session.role === "owner"
                  ? "Reopen it to add to the conversation."
                  : "An owner can reopen it if there is more to do."}
              </span>
            </p>
          ) : (
            <div className="card card-pad">
              <div className="section-title">Add to the conversation</div>
              <Composer ticketId={ticket.id} />
            </div>
          )}
        </div>

        <aside>
          <div className="card card-pad">
            <div className="control-stack">
              <InlineSelect
                action={setStatusAction}
                label="Status"
                name="status"
                ticketId={ticket.id}
                value={ticket.status}
                options={statusOptions.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                }))}
              />

              <InlineSelect
                action={setQueueAction}
                label="Queue"
                name="queueId"
                ticketId={ticket.id}
                value={ticket.queue_id?.toString() ?? ""}
                options={queues.map((queue) => ({
                  value: String(queue.id),
                  label: queue.name,
                }))}
                disabled={locked}
              />

              <InlineSelect
                action={setPriorityAction}
                label="Priority"
                name="priority"
                ticketId={ticket.id}
                value={ticket.priority}
                options={PRIORITIES.map((priority) => ({
                  value: priority,
                  label: PRIORITY_LABELS[priority],
                }))}
                disabled={locked}
              />

              <InlineSelect
                action={setAssigneeAction}
                label="Assignee"
                name="assignedAgentId"
                ticketId={ticket.id}
                value={ticket.assigned_agent_id?.toString() ?? ""}
                options={[
                  { value: "", label: "Unassigned" },
                  ...agents.map((agent) => ({
                    value: String(agent.id),
                    label: agent.name,
                  })),
                ]}
                disabled={locked}
              />

              {!locked && ticket.assigned_agent_id === null ? (
                <form action={claimTicketAction} className="claim-row">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <button className="btn btn-secondary" type="submit">
                    Claim this ticket
                  </button>
                  <span className="hint">Nobody owns it yet.</span>
                </form>
              ) : null}
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">Details</div>
            <dl>
              <div className="meta-row">
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={ticket.status} />
                </dd>
              </div>
              <div className="meta-row">
                <dt>Priority</dt>
                <dd>
                  <PriorityBadge priority={ticket.priority} />
                </dd>
              </div>
              <div className="meta-row">
                <dt>Queue</dt>
                <dd>{ticket.queue_name ?? "—"}</dd>
              </div>
              <div className="meta-row">
                <dt>Requester</dt>
                <dd>{ticket.requester_email ?? "—"}</dd>
              </div>
              <div className="meta-row">
                <dt>Created</dt>
                <dd>{formatDateTime(ticket.created_at)}</dd>
              </div>
              <div className="meta-row">
                <dt>Updated</dt>
                <dd>{formatDateTime(ticket.updated_at)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}
