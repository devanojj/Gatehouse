import Link from "next/link";
import { notFound } from "next/navigation";

import {
  claimTicketAction,
  setAssigneeAction,
  setPriorityAction,
  setStatusAction,
  setTicketQueueAction,
} from "@/app/actions/tickets";
import { listAgents } from "@/lib/agents";
import {
  ALLOWED_EXTENSIONS,
  formatBytes,
  listTicketAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_POST,
  type Attachment,
} from "@/lib/attachments";
import { requireSession } from "@/lib/auth";
import { listComments } from "@/lib/comments";
import { formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";
import { applyMacro, listMacros } from "@/lib/macros";
import { getOrganization } from "@/lib/orgs";
import { listQueues } from "@/lib/queues";
import { listTicketEvents, type TicketEvent } from "@/lib/ticket-events";
import { getTicket, PRIORITIES, STATUSES } from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

import type { Comment, CommentType } from "@/lib/comments";

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

/** Comments and activity events, interleaved by the clock. */
type TimelineEntry =
  | { kind: "comment"; at: string; id: number; comment: Comment }
  | { kind: "event"; at: string; id: number; event: TicketEvent };

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

  const [comments, events, agents, queues, macros, attachments, org] =
    await Promise.all([
      listComments(session.orgId, ticketId),
      listTicketEvents(session.orgId, ticketId),
      listAgents(session.orgId),
      listQueues(session.orgId),
      listMacros(session.orgId),
      listTicketAttachments(session.orgId, ticketId),
      getOrganization(session.orgId),
    ]);

  const timeline: TimelineEntry[] = [
    ...comments.map((comment) => ({
      kind: "comment" as const,
      at: comment.created_at,
      id: comment.id,
      comment,
    })),
    ...events.map((event) => ({
      kind: "event" as const,
      at: event.created_at,
      id: event.id,
      event,
    })),
  ].sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      // A change made alongside a reply reads better after it.
      (a.kind === b.kind ? a.id - b.id : a.kind === "comment" ? -1 : 1),
  );

  const byComment = new Map<number, Attachment[]>();
  const ticketAttachments: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.comment_id === null) {
      ticketAttachments.push(attachment);
      continue;
    }
    const existing = byComment.get(attachment.comment_id) ?? [];
    existing.push(attachment);
    byComment.set(attachment.comment_id, existing);
  }

  // Macros are filled in here, on the server, so the composer receives plain
  // strings and never has to know what a ticket or an organization is.
  const composerMacros = macros.map((macro) => ({
    id: macro.id,
    name: macro.name,
    body: applyMacro(macro.body, {
      ticketNumber: ticket.id,
      ticketSubject: ticket.subject,
      requesterEmail: ticket.requester_email,
      agentName: session.agentName,
      orgName: org?.name ?? session.orgName,
    }),
  }));

  const mine = ticket.assigned_agent_id === session.agentId;

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
            <AttachmentList attachments={ticketAttachments} />
          </div>

          <div className="card card-pad">
            <div className="section-title">
              Conversation
              {comments.length > 0 ? ` · ${comments.length}` : ""}
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
                      key={`comment-${entry.id}`}
                      className={`comment comment-${entry.comment.type}`}
                    >
                      <div className="comment-head">
                        <span className="comment-author">
                          {entry.comment.type === "inbound"
                            ? (entry.comment.author_email ?? "Client")
                            : (entry.comment.agent_name ?? "Unknown")}
                        </span>
                        <span
                          className={`badge ${COMMENT_TONE[entry.comment.type]}`}
                        >
                          {COMMENT_LABELS[entry.comment.type]}
                        </span>
                        <span className="comment-time">
                          {formatDateTime(entry.comment.created_at)}
                        </span>
                      </div>
                      {entry.comment.body ? (
                        <p className="comment-body">{entry.comment.body}</p>
                      ) : null}
                      <AttachmentList
                        attachments={byComment.get(entry.id) ?? []}
                      />
                    </article>
                  ) : (
                    <p className="system-note" key={`event-${entry.id}`}>
                      <span>{describeEvent(entry.event)}</span>
                      <span className="system-note-time">
                        {formatDateTime(entry.event.created_at)}
                      </span>
                    </p>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title">Add to the conversation</div>
            <Composer
              ticketId={ticket.id}
              macros={composerMacros}
              accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
              maxFiles={MAX_ATTACHMENTS_PER_POST}
              maxFileSize={formatBytes(MAX_ATTACHMENT_BYTES)}
            />
          </div>
        </div>

        <aside>
          <div className="card card-pad">
            <div className="control-stack">
              {!mine ? (
                <form action={claimTicketAction}>
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <button className="btn btn-secondary" type="submit">
                    Take it
                  </button>
                </form>
              ) : (
                <p className="hint" style={{ marginTop: 0 }}>
                  Assigned to you.
                </p>
              )}

              <InlineSelect
                action={setStatusAction}
                label="Status"
                name="status"
                ticketId={ticket.id}
                value={ticket.status}
                options={STATUSES.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                }))}
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
              />

              <InlineSelect
                action={setTicketQueueAction}
                label="Queue"
                name="queueId"
                ticketId={ticket.id}
                value={ticket.queue_id?.toString() ?? ""}
                options={[
                  { value: "", label: "No queue" },
                  ...queues.map((queue) => ({
                    value: String(queue.id),
                    label: queue.name,
                  })),
                ]}
              />
            </div>

            {queues.length === 0 && session.role === "owner" ? (
              <p className="hint">
                <Link href="/settings/queues">Create a queue</Link> to route
                tickets to a team.
              </p>
            ) : null}
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

/**
 * Attachments are linked by id alone. The bytes come back from
 * `/api/attachments/[id]`, which resolves the id inside the caller's own
 * organization before it returns anything — the storage key never leaves the
 * server.
 */
function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachments">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          className="attachment"
          href={`/api/attachments/${attachment.id}`}
        >
          <span className="attachment-name">{attachment.filename}</span>
          <span className="attachment-size">
            {formatBytes(attachment.size_bytes)}
          </span>
        </a>
      ))}
    </div>
  );
}

/**
 * A system notice for one activity event.
 *
 * Values were stored as display text when the event was written, inside the
 * organization it belongs to, so nothing here joins back out to another table
 * and no id is ever shown.
 */
function describeEvent(event: TicketEvent): string {
  const who = event.agent_name ?? "Gatehouse";
  const status = (value: string | null) =>
    value ? (STATUS_LABELS[value] ?? value) : "none";
  const priority = (value: string | null) =>
    value ? (PRIORITY_LABELS[value] ?? value) : "none";

  switch (event.type) {
    case "created":
      return event.new_value === "email"
        ? "Ticket opened from an inbound email."
        : `${who} opened this ticket.`;
    case "status":
      return `${who} changed the status from ${status(event.old_value)} to ${status(event.new_value)}.`;
    case "priority":
      return `${who} changed the priority from ${priority(event.old_value)} to ${priority(event.new_value)}.`;
    case "assignee":
      if (!event.new_value) return `${who} unassigned this ticket.`;
      return event.old_value
        ? `${who} reassigned this ticket from ${event.old_value} to ${event.new_value}.`
        : `${who} assigned this ticket to ${event.new_value}.`;
    case "claimed":
      return `${who} took this ticket.`;
    case "queue":
      if (!event.new_value) {
        return `${who} took this ticket out of ${event.old_value ?? "its queue"}.`;
      }
      return `${who} moved this ticket to ${event.new_value}.`;
    case "reopened":
      return `Reopened by a reply from the customer (was ${status(event.old_value)}).`;
    default:
      return `${who} updated this ticket.`;
  }
}
