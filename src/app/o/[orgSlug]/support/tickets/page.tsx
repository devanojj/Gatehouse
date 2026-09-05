import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCustomerSession } from "@/lib/customer-auth";
import { formatDate } from "@/lib/format";
import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_TONE,
  portalOrganization,
  toPortalTicket,
} from "@/lib/portal";
import { isStatus, listCustomerTickets, STATUSES } from "@/lib/tickets";

export default async function CustomerTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { orgSlug } = await params;
  const { status: rawStatus, q } = await searchParams;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  // The org here comes from the session, not the URL. A session belonging to
  // another tenant is redirected to this portal's sign-in rather than served.
  const session = await requireCustomerSession(org.id, orgSlug);

  const status = isStatus(rawStatus) ? rawStatus : undefined;
  const search = q?.trim() ?? "";

  const tickets = (
    await listCustomerTickets(session.orgId, session.customerId, {
      status,
      search,
    })
  ).map(toPortalTicket);

  const filterHref = (next?: string) => {
    const query = new URLSearchParams();
    if (next) query.set("status", next);
    if (search) query.set("q", search);
    const rendered = query.toString();
    return rendered
      ? `/o/${orgSlug}/support/tickets?${rendered}`
      : `/o/${orgSlug}/support/tickets`;
  };

  return (
    <div className="portal-panel">
      <div className="page-head">
        <div>
          <h1>Your requests</h1>
          <p className="muted">Everything you have raised with {org.name}.</p>
        </div>
        <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
          New request
        </Link>
      </div>

      <form className="portal-search" method="get">
        <label className="visually-hidden" htmlFor="q">
          Search your requests
        </label>
        <input
          id="q"
          name="q"
          defaultValue={search}
          placeholder="Reference number or a word from the subject"
        />
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <button className="btn btn-secondary" type="submit">
          Search
        </button>
      </form>

      <nav className="filter-row" aria-label="Status">
        <span className="filter-label">Status</span>
        <Link href={filterHref()} aria-current={status ? undefined : "page"}>
          All
        </Link>
        {STATUSES.map((option) => (
          <Link
            key={option}
            href={filterHref(option)}
            aria-current={status === option ? "page" : undefined}
          >
            {CUSTOMER_STATUS_LABELS[option]}
          </Link>
        ))}
      </nav>

      <div className="card">
        {tickets.length === 0 ? (
          <p className="empty">
            {status || search ? (
              <>
                Nothing matches that.{" "}
                <Link href={`/o/${orgSlug}/support/tickets`}>Show everything</Link>
              </>
            ) : (
              <>
                You have not raised anything yet.{" "}
                <Link href={`/o/${orgSlug}/support/new`}>Start a request</Link>
              </>
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Raised</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="num">#{ticket.id}</td>
                    <td className="subject">
                      <Link href={`/o/${orgSlug}/support/tickets/${ticket.id}`}>
                        {ticket.subject}
                      </Link>
                    </td>
                    <td>
                      <span className={`badge ${CUSTOMER_STATUS_TONE[ticket.status]}`}>
                        {CUSTOMER_STATUS_LABELS[ticket.status]}
                      </span>
                    </td>
                    <td className="muted nowrap">{formatDate(ticket.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
