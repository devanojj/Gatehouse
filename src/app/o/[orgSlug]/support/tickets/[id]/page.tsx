import Link from "next/link";
import { notFound } from "next/navigation";

import { listComments } from "@/lib/comments";
import { requireCustomerSession } from "@/lib/customer-auth";
import { formatDateTime } from "@/lib/format";
import {
  customerCanReply,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_TONE,
  portalOrganization,
  toPortalMessages,
  toPortalTicket,
} from "@/lib/portal";
import { getCustomerTicket } from "@/lib/tickets";

import { CustomerReply } from "./CustomerReply";

export default async function CustomerTicketPage({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string }>;
}) {
  const { orgSlug, id } = await params;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const session = await requireCustomerSession(org.id, orgSlug);

  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) notFound();

  // Scoped to the session's org *and* customer, so somebody else's ticket
  // number — in this tenant or another — is a 404 rather than a leak.
  const row = await getCustomerTicket(session.orgId, session.customerId, ticketId);
  if (!row) notFound();

  const ticket = toPortalTicket(row);
  const messages = toPortalMessages(
    await listComments(session.orgId, ticketId),
    org.name,
  );

  return (
    <div className="portal-panel">
      <p className="muted">
        <Link href={`/o/${orgSlug}/support/tickets`}>Your requests</Link> / #
        {ticket.id}
      </p>

      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <p className="muted">Raised {formatDateTime(ticket.created_at)}</p>
        </div>
        <span className={`badge ${CUSTOMER_STATUS_TONE[ticket.status]}`}>
          {CUSTOMER_STATUS_LABELS[ticket.status]}
        </span>
      </div>

      {ticket.status === "resolved" ? (
        <p className="notice notice-ok" role="status">
          {org.name} marked this resolved
          {ticket.resolved_at ? ` on ${formatDateTime(ticket.resolved_at)}` : ""}.
          If it is not sorted, reply below and it reopens.
        </p>
      ) : null}

      {ticket.status === "closed" ? (
        <p className="notice notice-info" role="status">
          This request is closed. Raise a new one and we will pick it up.
        </p>
      ) : null}

      <div className="card card-pad">
        <div className="section-title">What you told us</div>
        <p className="ticket-description">{ticket.description}</p>
      </div>

      <div className="card card-pad">
        <div className="section-title">Conversation</div>

        {messages.length === 0 ? (
          <p className="muted">
            Nothing yet. {org.name} will reply here and by email.
          </p>
        ) : (
          <div className="thread">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`comment ${message.fromClient ? "comment-inbound" : "comment-public"}`}
              >
                <div className="comment-head">
                  <span className="comment-author">{message.author}</span>
                  <span className="comment-time">
                    {formatDateTime(message.created_at)}
                  </span>
                </div>
                <p className="comment-body">{message.body}</p>
              </article>
            ))}
          </div>
        )}
      </div>

      {customerCanReply(ticket) ? (
        <div className="card card-pad">
          <CustomerReply ticketId={ticket.id} />
        </div>
      ) : null}
    </div>
  );
}
