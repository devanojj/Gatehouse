import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { formatDate, STATUS_SHORT_LABELS } from "@/lib/format";
import { listQueues, listQueuesForAgent } from "@/lib/queues";
import {
  countTicketsByStatus,
  countTicketViews,
  isStatus,
  listTickets,
  STATUSES,
  TICKET_LIST_LIMIT,
  type TicketFilter,
} from "@/lib/tickets";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";

/**
 * The saved views. Each one is a named set of filters rather than a query the
 * URL can shape freely — `view=mine` cannot be talked into showing another
 * agent's tickets, because the agent id comes from the session below.
 */
const VIEWS = ["all", "mine", "unassigned", "waiting", "urgent"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  all: "All tickets",
  mine: "My open tickets",
  unassigned: "Unassigned",
  waiting: "Waiting on customer",
  urgent: "Urgent",
};

function isView(value: unknown): value is View {
  return VIEWS.includes(value as View);
}

type Params = {
  view?: string;
  status?: string;
  queue?: string;
  q?: string;
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const view: View = isView(params.view) ? params.view : "all";
  const status = isStatus(params.status) ? params.status : undefined;
  const search = params.q?.trim() ? params.q.trim().slice(0, 120) : undefined;

  // "none" is the only non-numeric queue filter; anything else has to be an id
  // and is still matched inside this org by `listTickets`.
  const queueParam = params.queue?.trim();
  const queueId =
    queueParam && queueParam !== "none" && /^\d{1,9}$/.test(queueParam)
      ? Number(queueParam)
      : undefined;
  const noQueue = queueParam === "none";

  const filter: TicketFilter = { status, queueId, noQueue, search };

  if (view === "mine") {
    filter.activeOnly = true;
    filter.assignedAgentId = session.agentId;
  } else if (view === "unassigned") {
    filter.activeOnly = true;
    filter.unassigned = true;
  } else if (view === "waiting") {
    filter.status = status ?? "pending";
  } else if (view === "urgent") {
    filter.activeOnly = true;
    filter.priority = "high";
  }

  const [tickets, counts, viewCounts, queues, myQueues] = await Promise.all([
    listTickets(session.orgId, filter),
    countTicketsByStatus(session.orgId),
    countTicketViews(session.orgId, session.agentId),
    listQueues(session.orgId),
    listQueuesForAgent(session.orgId, session.agentId),
  ]);

  /** Keeps the filters that are still meaningful when one of them changes. */
  function href(overrides: Partial<Params>): string {
    const next = new URLSearchParams();
    const merged: Params = {
      view: params.view,
      status: params.status,
      queue: params.queue,
      q: params.q,
      ...overrides,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (!value) continue;
      // "all" is the default view and stays out of the URL; a search for the
      // word "all" is still a search.
      if (key === "view" && value === "all") continue;
      next.set(key, value);
    }

    const query = next.toString();
    return query ? `/tickets?${query}` : "/tickets";
  }

  const viewCount: Record<View, number> = {
    all: counts.all,
    mine: viewCounts.mine,
    unassigned: viewCounts.unassigned,
    waiting: viewCounts.waiting,
    urgent: viewCounts.urgent,
  };

  const activeQueue = queues.find((queue) => queue.id === queueId);

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

      <nav className="views" aria-label="Views">
        {VIEWS.map((key) => (
          <Link
            key={key}
            href={href({ view: key === "all" ? undefined : key })}
            aria-current={view === key ? "page" : undefined}
          >
            {VIEW_LABELS[key]}
            <span className="tab-count">{viewCount[key]}</span>
          </Link>
        ))}

        {myQueues.map((queue) => (
          <Link
            key={queue.id}
            href={href({ queue: String(queue.id) })}
            aria-current={queueId === queue.id ? "page" : undefined}
          >
            {queue.name}
            <span className="tab-count">{queue.open_count ?? 0}</span>
          </Link>
        ))}
      </nav>

      <nav className="tabs" aria-label="Status">
        <Link
          href={href({ status: undefined })}
          aria-current={status ? undefined : "page"}
        >
          Any status
          <span className="tab-count">{counts.all}</span>
        </Link>
        {STATUSES.map((key) => (
          <Link
            key={key}
            href={href({ status: key })}
            aria-current={status === key ? "page" : undefined}
          >
            {STATUS_SHORT_LABELS[key]}
            <span className="tab-count">{counts[key] ?? 0}</span>
          </Link>
        ))}
      </nav>

      {/* A plain GET form: no JavaScript, and the filters end up in the URL so
          a view can be linked to or bookmarked. */}
      <form className="filter-bar" action="/tickets">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}

        <div className="field">
          <label className="label" htmlFor="filter-queue">
            Queue
          </label>
          <select id="filter-queue" name="queue" defaultValue={queueParam ?? ""}>
            <option value="">Any queue</option>
            <option value="none">No queue</option>
            {queues.map((queue) => (
              <option key={queue.id} value={String(queue.id)}>
                {queue.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="filter-q">
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="Ticket number, subject, sender…"
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" type="submit">
            Apply
          </button>
          {search || queueParam || status || view !== "all" ? (
            <Link className="btn-link" href="/tickets">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {search || activeQueue || noQueue ? (
        <div className="search-summary">
          <span className="muted">
            {tickets.length === TICKET_LIST_LIMIT
              ? `First ${TICKET_LIST_LIMIT} matches`
              : `${tickets.length} ${tickets.length === 1 ? "match" : "matches"}`}
            {search ? ` for “${search}”` : ""}
            {activeQueue ? ` in ${activeQueue.name}` : ""}
            {noQueue ? " with no queue" : ""}
          </span>
        </div>
      ) : null}

      <div className="card">
        {tickets.length === 0 ? (
          <p className="empty">
            {search
              ? "Nothing matches that search."
              : view === "all" && !status && !queueParam
                ? "No tickets yet. Create the first one."
                : "No tickets in this view."}
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
                  <th>Queue</th>
                  <th>Assignee</th>
                  <th>Updated</th>
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
                    <td className="muted nowrap">{ticket.queue_name ?? "—"}</td>
                    <td className="muted nowrap">
                      {ticket.assigned_agent_name ?? "Unassigned"}
                    </td>
                    <td className="muted nowrap">{formatDate(ticket.updated_at)}</td>
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
