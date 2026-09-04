import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { formatDate, STATUS_LABELS } from "@/lib/format";
import { listQueues } from "@/lib/queues";
import { countTicketsByStatus, isStatus, listTickets, STATUSES } from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

/**
 * Filters live in the URL so a view is a link an agent can send to a colleague.
 * Both are rebuilt from the current state rather than appended, so switching
 * status keeps the queue and the other way round.
 */
function hrefFor(status: string | undefined, queueId: number | undefined) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (queueId) params.set("queue", String(queueId));

  const query = params.toString();
  return query ? `/tickets?${query}` : "/tickets";
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; queue?: string }>;
}) {
  const session = await requireSession();
  const { status: rawStatus, queue: rawQueue } = await searchParams;

  const status = isStatus(rawStatus) ? rawStatus : undefined;
  const queues = await listQueues(session.orgId);

  // A queue id from the URL is only honoured if it belongs to this org; anything
  // else falls back to "all queues" rather than showing an empty list that looks
  // like the org has no tickets.
  const requestedQueue = Number(rawQueue);
  const queue = queues.find((candidate) => candidate.id === requestedQueue);

  const [tickets, counts] = await Promise.all([
    listTickets(session.orgId, { status, queueId: queue?.id }),
    countTicketsByStatus(session.orgId, queue?.id),
  ]);

  const activeStatus = status ?? "all";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p>
            {queue
              ? `${queue.name} · ${session.orgName}`
              : `Everything ${session.orgName} is working on.`}
          </p>
        </div>
        <Link className="btn btn-primary" href="/tickets/new">
          New ticket
        </Link>
      </div>

      <nav className="tabs">
        <Link
          href={hrefFor(undefined, queue?.id)}
          aria-current={activeStatus === "all" ? "page" : undefined}
        >
          All
          <span className="tab-count">{counts.all ?? 0}</span>
        </Link>
        {STATUSES.map((option) => (
          <Link
            key={option}
            href={hrefFor(option, queue?.id)}
            aria-current={activeStatus === option ? "page" : undefined}
          >
            {STATUS_LABELS[option]}
            <span className="tab-count">{counts[option] ?? 0}</span>
          </Link>
        ))}
      </nav>

      {queues.length > 1 ? (
        <nav className="filter-row" aria-label="Queue">
          <span className="filter-label">Queue</span>
          <Link
            href={hrefFor(status, undefined)}
            aria-current={queue ? undefined : "page"}
          >
            All queues
          </Link>
          {queues.map((option) => (
            <Link
              key={option.id}
              href={hrefFor(status, option.id)}
              aria-current={queue?.id === option.id ? "page" : undefined}
            >
              {option.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="card">
        {tickets.length === 0 ? (
          <p className="empty">
            {status || queue ? (
              <>
                Nothing matches {status ? STATUS_LABELS[status].toLowerCase() : "this view"}
                {queue ? ` in ${queue.name}` : ""}.{" "}
                <Link href="/tickets">Clear the filters</Link>
              </>
            ) : (
              "No tickets yet. Create the first one."
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Queue</th>
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
                    <td className="muted nowrap">{ticket.queue_name ?? "—"}</td>
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
