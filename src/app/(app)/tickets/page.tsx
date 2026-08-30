import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { countTicketsByStatus, isStatus, listTickets } from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

const TABS = [
  { key: "all", label: "All", href: "/tickets" },
  { key: "open", label: "Open", href: "/tickets?status=open" },
  { key: "in-progress", label: "In progress", href: "/tickets?status=in-progress" },
  { key: "closed", label: "Closed", href: "/tickets?status=closed" },
];

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  const { status: raw } = await searchParams;

  const status = isStatus(raw) ? raw : undefined;
  const [tickets, counts] = await Promise.all([
    listTickets(session.orgId, status),
    countTicketsByStatus(session.orgId),
  ]);

  const active = status ?? "all";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p>Everything {session.orgName} is working on.</p>
        </div>
        <Link className="btn btn-primary" href="/tickets/new">
          New ticket
        </Link>
      </div>

      <nav className="tabs">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}
          >
            {tab.label}
            <span className="tab-count">{counts[tab.key] ?? 0}</span>
          </Link>
        ))}
      </nav>

      <div className="card">
        {tickets.length === 0 ? (
          <p className="empty">
            {status
              ? "No tickets with this status."
              : "No tickets yet. Create the first one."}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="num">{ticket.id}</td>
                    <td className="subject">
                      <Link href={`/tickets/${ticket.id}`}>{ticket.subject}</Link>
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="muted nowrap">
                      {ticket.assigned_agent_name ?? "Unassigned"}
                    </td>
                    <td className="muted nowrap">{formatDate(ticket.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
