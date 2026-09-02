import Link from "next/link";
import { notFound } from "next/navigation";

import {
  setAssigneeAction,
  setPriorityAction,
  setStatusAction,
} from "@/app/actions/tickets";
import { listAgents } from "@/lib/agents";
import { requireSession } from "@/lib/auth";
import { listComments } from "@/lib/comments";
import { formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";
import { getTicket, PRIORITIES, STATUSES } from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

import type { CommentType } from "@/lib/comments";

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

  const [comments, agents] = await Promise.all([
    listComments(session.orgId, ticketId),
    listAgents(session.orgId),
  ]);

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
              Conversation
              {comments.length > 0 ? ` · ${comments.length}` : ""}
            </div>

            {comments.length === 0 ? (
              <p className="muted">
                Nothing here yet. Reply to the client or leave an internal note.
              </p>
            ) : (
              <div className="thread">
                {comments.map((comment) => (
                  <article
                    key={comment.id}
                    className={`comment comment-${comment.type}`}
                  >
                    <div className="comment-head">
                      <span className="comment-author">
                        {comment.type === "inbound"
                          ? (comment.author_email ?? "Client")
                          : (comment.agent_name ?? "Unknown")}
                      </span>
                      <span className={`badge ${COMMENT_TONE[comment.type]}`}>
                        {COMMENT_LABELS[comment.type]}
                      </span>
                      <span className="comment-time">
                        {formatDateTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="comment-body">{comment.body}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title">Add to the conversation</div>
            <Composer ticketId={ticket.id} />
          </div>
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
