import Link from "next/link";

import { listAgents } from "@/lib/agents";
import { requireSession } from "@/lib/auth";
import {
  countAuditEvents,
  listAuditEvents,
  EVENT_KINDS,
  isEventKind,
  type EventKind,
} from "@/lib/events";

const PAGE_SIZE = 40;

function formatEventKind(kind: EventKind): string {
  switch (kind) {
    case "created":
      return "Ticket Created";
    case "status_changed":
      return "Status Changed";
    case "priority_changed":
      return "Priority Changed";
    case "assignee_changed":
      return "Assignee Changed";
    case "queue_changed":
      return "Queue Moved";
    case "sla_breached":
      return "SLA Breached";
    case "sla_warning":
      return "SLA Warning";
    case "rule_applied":
      return "Rule Applied";
    default:
      return kind;
  }
}

function eventKindBadgeClass(kind: EventKind): string {
  switch (kind) {
    case "sla_breached":
      return "badge-error";
    case "sla_warning":
      return "badge-warning";
    case "created":
      return "badge-success";
    case "status_changed":
      return "badge-neutral";
    case "rule_applied":
      return "badge-warning";
    default:
      return "badge-neutral";
  }
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    actorId?: string;
    kind?: string;
    ticketId?: string;
    fromDate?: string;
    toDate?: string;
    page?: string;
  }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const actorAgentId =
    params.actorId && Number.isInteger(Number(params.actorId))
      ? Number(params.actorId)
      : undefined;

  const kind = isEventKind(params.kind) ? params.kind : undefined;

  const ticketId =
    params.ticketId && Number.isInteger(Number(params.ticketId))
      ? Number(params.ticketId)
      : undefined;

  const fromDate = params.fromDate || undefined;
  const toDate = params.toDate || undefined;

  const page = Math.max(1, Number(params.page || "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = {
    actorAgentId,
    kind,
    ticketId,
    fromDate,
    toDate,
  };

  const [events, totalCount, agents] = await Promise.all([
    listAuditEvents(session.orgId, { ...filters, limit: PAGE_SIZE, offset }),
    countAuditEvents(session.orgId, filters),
    listAgents(session.orgId),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="container audit-container">
      <div className="settings-header">
        <h1 className="page-title">Workspace Audit Log</h1>
        <p className="page-subtitle">
          Comprehensive, immutable audit trail of ticket activities, state transitions, SLA events,
          and routing rules for {session.orgName}.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="card card-pad mb-4">
        <form method="GET" action="/settings/audit" className="audit-filter-form">
          <div className="audit-filter-row">
            <div className="filter-col">
              <label htmlFor="actorId" className="form-label text-xs">
                Actor
              </label>
              <select
                id="actorId"
                name="actorId"
                defaultValue={params.actorId ?? ""}
                className="form-select text-xs"
              >
                <option value="">All Actors</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-col">
              <label htmlFor="kind" className="form-label text-xs">
                Event Action
              </label>
              <select
                id="kind"
                name="kind"
                defaultValue={params.kind ?? ""}
                className="form-select text-xs"
              >
                <option value="">All Events</option>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {formatEventKind(k)}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-col">
              <label htmlFor="ticketId" className="form-label text-xs">
                Ticket #
              </label>
              <input
                id="ticketId"
                name="ticketId"
                type="number"
                defaultValue={params.ticketId ?? ""}
                placeholder="e.g. 42"
                className="form-input text-xs"
              />
            </div>

            <div className="filter-col">
              <label htmlFor="fromDate" className="form-label text-xs">
                From Date
              </label>
              <input
                id="fromDate"
                name="fromDate"
                type="date"
                defaultValue={params.fromDate ?? ""}
                className="form-input text-xs"
              />
            </div>

            <div className="filter-col">
              <label htmlFor="toDate" className="form-label text-xs">
                To Date
              </label>
              <input
                id="toDate"
                name="toDate"
                type="date"
                defaultValue={params.toDate ?? ""}
                className="form-input text-xs"
              />
            </div>

            <div className="filter-actions-col">
              <button type="submit" className="btn btn-primary btn-sm">
                Apply Filters
              </button>
              <Link href="/settings/audit" className="btn btn-secondary btn-sm">
                Reset
              </Link>
            </div>
          </div>
        </form>
      </div>

      {/* Audit Log Table */}
      <div className="card card-pad">
        <div className="audit-table-meta mb-3">
          <span className="font-semibold text-sm">
            Showing {events.length > 0 ? offset + 1 : 0}–{Math.min(offset + events.length, totalCount)} of {totalCount} events
          </span>
        </div>

        {events.length === 0 ? (
          <p className="muted py-4 text-center">No audit events match the specified filters.</p>
        ) : (
          <table className="table audit-table">
            <thead>
              <tr>
                <th style={{ width: "160px" }}>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Ticket</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id}>
                  <td className="font-mono text-xs text-muted">
                    {evt.created_at}
                  </td>
                  <td>
                    <span className="font-semibold text-sm">
                      {evt.actor_agent_name ?? "System / Scheduler"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${eventKindBadgeClass(evt.kind)} text-xs`}>
                      {formatEventKind(evt.kind)}
                    </span>
                  </td>
                  <td>
                    <Link href={`/tickets/${evt.ticket_id}`} className="audit-ticket-link">
                      #{evt.ticket_id} {evt.ticket_subject ? `— ${evt.ticket_subject}` : ""}
                    </Link>
                  </td>
                  <td className="text-sm">
                    {evt.kind === "status_changed" && (
                      <span>
                        <span className="muted font-mono">{evt.from_value}</span> →{" "}
                        <span className="font-semibold font-mono">{evt.to_value}</span>
                      </span>
                    )}
                    {evt.kind === "priority_changed" && (
                      <span>
                        <span className="muted font-mono">{evt.from_value}</span> →{" "}
                        <span className="font-semibold font-mono">{evt.to_value}</span>
                      </span>
                    )}
                    {evt.kind === "assignee_changed" && (
                      <span>
                        Assigned to: <span className="font-semibold">{evt.to_value ?? "Unassigned"}</span>
                      </span>
                    )}
                    {evt.kind === "queue_changed" && (
                      <span>
                        Moved to: <span className="font-semibold">{evt.to_value}</span> queue
                      </span>
                    )}
                    {evt.kind === "rule_applied" && (
                      <span>
                        Matched rule: <span className="font-semibold">{evt.to_value}</span>
                      </span>
                    )}
                    {evt.kind === "sla_breached" && (
                      <span className="text-error font-medium">{evt.to_value}</span>
                    )}
                    {evt.kind === "sla_warning" && (
                      <span className="text-warn font-medium">{evt.to_value}</span>
                    )}
                    {evt.kind === "created" && (
                      <span className="muted text-xs">Origin: {evt.to_value ?? "portal"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination mt-4">
            {page > 1 ? (
              <Link
                href={`/settings/audit?page=${page - 1}${
                  params.actorId ? `&actorId=${params.actorId}` : ""
                }${params.kind ? `&kind=${params.kind}` : ""}${
                  params.ticketId ? `&ticketId=${params.ticketId}` : ""
                }${params.fromDate ? `&fromDate=${params.fromDate}` : ""}${
                  params.toDate ? `&toDate=${params.toDate}` : ""
                }`}
                className="btn btn-secondary btn-sm"
              >
                Previous
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50 cursor-not-allowed">
                Previous
              </span>
            )}

            <span className="font-mono text-sm muted">
              Page {page} of {totalPages}
            </span>

            {page < totalPages ? (
              <Link
                href={`/settings/audit?page=${page + 1}${
                  params.actorId ? `&actorId=${params.actorId}` : ""
                }${params.kind ? `&kind=${params.kind}` : ""}${
                  params.ticketId ? `&ticketId=${params.ticketId}` : ""
                }${params.fromDate ? `&fromDate=${params.fromDate}` : ""}${
                  params.toDate ? `&toDate=${params.toDate}` : ""
                }`}
                className="btn btn-secondary btn-sm"
              >
                Next
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50 cursor-not-allowed">
                Next
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
