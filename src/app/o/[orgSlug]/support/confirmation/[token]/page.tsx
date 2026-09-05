import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/format";
import { portalOrganization } from "@/lib/portal";
import { getTicketByPublicToken } from "@/lib/tickets";

/**
 * The one page a stranger can open without signing in — and all it shows is
 * that the request arrived, plus its reference number. The conversation itself
 * is behind a verified email, because this link travels in a browser history,
 * a shared screen, and anywhere the URL is pasted.
 */
export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; token: string }>;
}) {
  const { orgSlug, token } = await params;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const ticket = await getTicketByPublicToken(org.id, token);

  if (!ticket) {
    return (
      <div className="portal-panel">
        <h1>That link has expired</h1>
        <p className="muted">
          Confirmation links last three days. Your request is still with{" "}
          {org.name} — sign in with the email you used and you will find it.
        </p>
        <div className="portal-actions">
          <Link className="btn btn-primary" href={`/o/${orgSlug}/support/login`}>
            Sign in to see it
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-panel">
      <h1>We have your request</h1>
      <p className="muted">
        {org.name} has it and will reply to {ticket.requester_email}.
      </p>

      <div className="card card-pad">
        <dl>
          <div className="meta-row">
            <dt>Reference</dt>
            <dd>
              <strong>#{ticket.id}</strong>
            </dd>
          </div>
          <div className="meta-row">
            <dt>Subject</dt>
            <dd>{ticket.subject}</dd>
          </div>
          <div className="meta-row">
            <dt>Received</dt>
            <dd>{formatDateTime(ticket.created_at)}</dd>
          </div>
        </dl>
      </div>

      <p className="hint">
        Quote <strong>#{ticket.id}</strong> if you write to us about this.
      </p>

      <div className="portal-actions">
        <Link className="btn btn-secondary" href={`/o/${orgSlug}/support/login`}>
          Follow this request
        </Link>
      </div>
    </div>
  );
}
