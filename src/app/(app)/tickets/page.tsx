import Link from "next/link";

import { deleteSavedViewAction } from "@/app/actions/views";
import { listAgents } from "@/lib/agents";
import { requireSession } from "@/lib/auth";
import { STATUS_LABELS } from "@/lib/format";
import { listQueues } from "@/lib/queues";
import {
  countTicketsByStatus,
  countTicketViews,
  isPriority,
  isStatus,
  listTickets,
  PRIORITIES,
  STATUSES,
  toTicketRowView,
} from "@/lib/tickets";
import type { Priority, Status, TicketFilters } from "@/lib/tickets";
import { listSavedViews } from "@/lib/views";

import { BulkTicketTable } from "./BulkTicketTable";
import { SaveViewForm } from "./SaveViewForm";

export const SYSTEM_VIEWS = [
  "all",
  "mine",
  "unassigned",
  "waiting",
  "urgent",
] as const;

export type SystemView = (typeof SYSTEM_VIEWS)[number];

const SYSTEM_VIEW_LABELS: Record<SystemView, string> = {
  all: "All",
  mine: "Assigned to me",
  unassigned: "Unassigned",
  waiting: "Waiting on client",
  urgent: "Urgent",
};

function isSystemView(value: unknown): value is SystemView {
  return SYSTEM_VIEWS.includes(value as SystemView);
}

type Params = {
  view?: string;
  status?: string;
  queue?: string;
  priority?: string;
  assignee?: string;
  q?: string;
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await requireSession();
  const rawParams = await searchParams;

  // Load saved views and queues early to resolve any URL params
  const [queues, savedViews, agents] = await Promise.all([
    listQueues(session.orgId),
    listSavedViews(session.orgId),
    listAgents(session.orgId),
  ]);

  // If a custom saved view is specified in ?view=id, parse its filters
  const requestedViewParam = rawParams.view?.trim();
  const matchedSavedView = savedViews.find(
    (sv) => String(sv.id) === requestedViewParam,
  );

  const effectiveParams: Params = { ...rawParams };
  if (matchedSavedView) {
    const parsed = new URLSearchParams(matchedSavedView.filters);
    if (!effectiveParams.status && parsed.get("status")) {
      effectiveParams.status = parsed.get("status")!;
    }
    if (!effectiveParams.queue && parsed.get("queue")) {
      effectiveParams.queue = parsed.get("queue")!;
    }
    if (!effectiveParams.priority && parsed.get("priority")) {
      effectiveParams.priority = parsed.get("priority")!;
    }
    if (!effectiveParams.assignee && parsed.get("assignee")) {
      effectiveParams.assignee = parsed.get("assignee")!;
    }
    if (!effectiveParams.q && parsed.get("q")) {
      effectiveParams.q = parsed.get("q")!;
    }
  }

  const rawStatus = effectiveParams.status;
  const rawQueue = effectiveParams.queue;
  const rawPriority = effectiveParams.priority;
  const rawAssignee = effectiveParams.assignee;
  const search = effectiveParams.q?.trim() ? effectiveParams.q.trim().slice(0, 150) : undefined;

  const status: Status | undefined = isStatus(rawStatus) ? rawStatus : undefined;
  const priority: Priority | undefined = isPriority(rawPriority) ? rawPriority : undefined;

  const requestedQueueId = Number(rawQueue);
  const queue = queues.find((candidate) => candidate.id === requestedQueueId);

  let unassigned: boolean | undefined;
  let assigneeId: number | undefined;
  if (rawAssignee === "unassigned") {
    unassigned = true;
  } else if (rawAssignee) {
    const requestedAgentId = Number(rawAssignee);
    const agent = agents.find((a) => a.id === requestedAgentId);
    if (agent) assigneeId = agent.id;
  }

  const activeView: string = matchedSavedView
    ? String(matchedSavedView.id)
    : isSystemView(requestedViewParam)
      ? requestedViewParam
      : "all";

  const filters: TicketFilters = {
    status,
    queueId: queue?.id,
    priority,
    assigneeId,
    unassigned,
    search,
  };

  // Apply system view rules
  if (activeView === "mine") {
    filters.activeOnly = true;
    filters.assigneeId = session.agentId;
  } else if (activeView === "unassigned") {
    filters.activeOnly = true;
    filters.unassigned = true;
  } else if (activeView === "waiting") {
    filters.status = status ?? "pending_customer";
  } else if (activeView === "urgent") {
    filters.activeOnly = true;
    filters.priority = priority ?? "high";
  }

  const [tickets, counts, viewCounts] = await Promise.all([
    listTickets(session.orgId, filters),
    countTicketsByStatus(session.orgId, queue?.id),
    countTicketViews(session.orgId, session.agentId),
  ]);

  /** Helper to generate URLs with preserved and updated filter parameters */
  function hrefFor(overrides: Partial<Params>): string {
    const next = new URLSearchParams();
    const merged: Params = {
      view: effectiveParams.view,
      status: effectiveParams.status,
      queue: effectiveParams.queue,
      priority: effectiveParams.priority,
      assignee: effectiveParams.assignee,
      q: effectiveParams.q,
      ...overrides,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (!value) continue;
      if (key === "view" && value === "all") continue;
      next.set(key, value);
    }

    const queryStr = next.toString();
    return queryStr ? `/tickets?${queryStr}` : "/tickets";
  }

  // Build the current filter string to allow saving as custom view
  const currentFiltersForSave = new URLSearchParams();
  if (status) currentFiltersForSave.set("status", status);
  if (queue) currentFiltersForSave.set("queue", String(queue.id));
  if (priority) currentFiltersForSave.set("priority", priority);
  if (rawAssignee) currentFiltersForSave.set("assignee", rawAssignee);
  if (search) currentFiltersForSave.set("q", search);
  const filterQueryString = currentFiltersForSave.toString();
  const hasActiveFilters = Boolean(
    status || queue || priority || rawAssignee || search || activeView !== "all",
  );

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

      {/* Views Navigation: System Views + Custom Saved Views */}
      <nav className="views" aria-label="Views">
        {SYSTEM_VIEWS.map((key) => {
          const count = viewCounts[key];
          return (
            <Link
              key={key}
              href={hrefFor({ view: key === "all" ? undefined : key })}
              aria-current={activeView === key ? "page" : undefined}
            >
              {SYSTEM_VIEW_LABELS[key]}
              <span className="tab-count">{count}</span>
            </Link>
          );
        })}

        {savedViews.map((sv) => (
          <div
            key={sv.id}
            className={`view-pill-custom ${activeView === String(sv.id) ? "active" : ""}`}
          >
            <Link
              href={hrefFor({ view: String(sv.id) })}
              aria-current={activeView === String(sv.id) ? "page" : undefined}
            >
              {sv.name}
            </Link>
            <form action={deleteSavedViewAction} className="inline-delete-form">
              <input type="hidden" name="viewId" value={sv.id} />
              <button
                type="submit"
                className="view-delete-btn"
                title={`Delete view ${sv.name}`}
                aria-label={`Delete view ${sv.name}`}
              >
                ×
              </button>
            </form>
          </div>
        ))}
      </nav>

      {/* Status tabs */}
      <nav className="tabs" aria-label="Status">
        <Link
          href={hrefFor({ status: undefined })}
          aria-current={!status ? "page" : undefined}
        >
          All
          <span className="tab-count">{counts.all ?? 0}</span>
        </Link>
        {STATUSES.map((option) => (
          <Link
            key={option}
            href={hrefFor({ status: option })}
            aria-current={status === option ? "page" : undefined}
          >
            {STATUS_LABELS[option]}
            <span className="tab-count">{counts[option] ?? 0}</span>
          </Link>
        ))}
      </nav>

      {/* Filter Bar with URL state synchronization */}
      <form className="filter-bar" action="/tickets" method="GET">
        {activeView && activeView !== "all" ? (
          <input type="hidden" name="view" value={activeView} />
        ) : null}

        <div className="field">
          <label className="label" htmlFor="filter-q">
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="Search subject, requester, notes…"
          />
        </div>

        {queues.length > 1 ? (
          <div className="field">
            <label className="label" htmlFor="filter-queue">
              Queue
            </label>
            <select id="filter-queue" name="queue" defaultValue={queue?.id ?? ""}>
              <option value="">All queues</option>
              {queues.map((q) => (
                <option key={q.id} value={String(q.id)}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="filter-priority">
            Priority
          </label>
          <select id="filter-priority" name="priority" defaultValue={priority ?? ""}>
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="filter-assignee">
            Assignee
          </label>
          <select id="filter-assignee" name="assignee" defaultValue={rawAssignee ?? ""}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions filter-actions">
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
          {hasActiveFilters ? (
            <Link className="btn-link" href="/tickets">
              Clear
            </Link>
          ) : null}
          {filterQueryString ? (
            <SaveViewForm filtersQuery={filterQueryString} />
          ) : null}
        </div>
      </form>

      {/* Search & Filter Results Summary */}
      {search || queue || priority || rawAssignee ? (
        <div className="search-summary">
          <span className="muted">
            {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
            {search ? ` matching “${search}”` : ""}
            {queue ? ` in ${queue.name}` : ""}
            {priority ? ` · ${priority} priority` : ""}
            {rawAssignee === "unassigned"
              ? " · unassigned"
              : assigneeId
                ? ` · assigned to ${agents.find((a) => a.id === assigneeId)?.name}`
                : ""}
          </span>
        </div>
      ) : null}

      {/* Ticket List Card with Bulk Actions */}
      <div className="card">
        {tickets.length === 0 ? (
          <p className="empty">
            {hasActiveFilters ? (
              <>
                No tickets match the current filters.{" "}
                <Link href="/tickets">Clear filters</Link>
              </>
            ) : (
              "No tickets yet. Create the first one."
            )}
          </p>
        ) : (
          <BulkTicketTable
            tickets={tickets.map(toTicketRowView)}
            queues={queues.map((queue) => ({ id: queue.id, name: queue.name }))}
            agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
            currentAgentId={session.agentId}
            userRole={session.role}
          />
        )}
      </div>
    </>
  );
}
