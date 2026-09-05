import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { getDashboardMetrics } from "@/lib/reports";

function formatHours(h: number): string {
  if (h === 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate.replace(" ", "T") + "Z").getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const metrics = await getDashboardMetrics(session.orgId);

  return (
    <div className="container dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Operational Dashboard</h1>
          <p className="page-subtitle">
            Real-time ticket triage, team workload, and SLA performance for {session.orgName}.
          </p>
        </div>
        <div className="dashboard-actions">
          <Link href="/tickets/new" className="btn btn-primary">
            New Ticket
          </Link>
          <Link href="/reports" className="btn btn-secondary">
            View Reports
          </Link>
        </div>
      </div>

      {/* Primary KPI Summary Grid */}
      <div className="kpi-grid">
        <Link href="/tickets" className="kpi-card">
          <div className="kpi-label">Active Tickets</div>
          <div className="kpi-val">{metrics.activeTickets}</div>
          <div className="kpi-foot">{metrics.ticketsToday} created today</div>
        </Link>

        <Link href="/tickets?view=unassigned" className="kpi-card">
          <div className="kpi-label">Unassigned</div>
          <div className={`kpi-val ${metrics.unassignedTickets > 0 ? "kpi-warn" : ""}`}>
            {metrics.unassignedTickets}
          </div>
          <div className="kpi-foot">Awaiting owner triage</div>
        </Link>

        <div className="kpi-card">
          <div className="kpi-label">SLA Breaches</div>
          <div className={`kpi-val ${metrics.slaBreachedTickets > 0 ? "kpi-alert" : ""}`}>
            {metrics.slaBreachedTickets}
          </div>
          <div className="kpi-foot">Overdue active tickets</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">SLA Due &lt; 1h</div>
          <div className={`kpi-val ${metrics.slaWarningTickets > 0 ? "kpi-warn" : ""}`}>
            {metrics.slaWarningTickets}
          </div>
          <div className="kpi-foot">Urgent attention needed</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Avg First Response</div>
          <div className="kpi-val">{formatHours(metrics.avgFirstResponseHours)}</div>
          <div className="kpi-foot">Last 30 days</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Avg Resolution Time</div>
          <div className="kpi-val">{formatHours(metrics.avgResolutionHours)}</div>
          <div className="kpi-foot">{metrics.resolvedToday} resolved today</div>
        </div>
      </div>

      {/* Breakdown Grid */}
      <div className="dashboard-columns">
        <div className="dashboard-main-col">
          {/* Workload by Queue */}
          <div className="card card-pad mb-4">
            <div className="card-header-flex">
              <h2 className="card-heading">Active Workload by Queue</h2>
              <Link href="/settings/queues" className="card-header-link">
                Manage Queues
              </Link>
            </div>
            {metrics.ticketsByQueue.length === 0 ? (
              <p className="muted">No queues configured yet.</p>
            ) : (
              <div className="queue-metric-list">
                {metrics.ticketsByQueue.map((q) => {
                  const pct =
                    metrics.activeTickets > 0
                      ? Math.round((q.count / metrics.activeTickets) * 100)
                      : 0;
                  return (
                    <div key={q.id} className="queue-metric-item">
                      <div className="queue-metric-label">
                        <span className="font-semibold">{q.name}</span>
                        <span className="muted font-mono">{q.count} tickets ({pct}%)</span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Priority & Status Breakdown */}
          <div className="breakdown-grid">
            <div className="card card-pad">
              <h2 className="card-heading mb-3">Active by Priority</h2>
              <div className="priority-pills-list">
                <div className="priority-pill-row">
                  <span className="badge badge-error">High</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByPriority.high}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="badge badge-warning">Medium</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByPriority.medium}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="badge badge-neutral">Low</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByPriority.low}</span>
                </div>
              </div>
            </div>

            <div className="card card-pad">
              <h2 className="card-heading mb-3">Status Distribution</h2>
              <div className="priority-pills-list">
                <div className="priority-pill-row">
                  <span className="muted">Open</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByStatus.open}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="muted">In Progress</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByStatus.in_progress}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="muted">Waiting on Client</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByStatus.pending_customer}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="muted">Resolved</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByStatus.resolved}</span>
                </div>
                <div className="priority-pill-row">
                  <span className="muted">Closed</span>
                  <span className="font-mono font-semibold">{metrics.ticketsByStatus.closed}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="dashboard-side-col">
          <div className="card card-pad">
            <div className="card-header-flex mb-3">
              <h2 className="card-heading">Live Activity Feed</h2>
              <Link href="/settings/audit" className="card-header-link">
                Full Audit Log
              </Link>
            </div>
            {metrics.recentEvents.length === 0 ? (
              <p className="muted">No recent events recorded.</p>
            ) : (
              <div className="activity-feed">
                {metrics.recentEvents.map((evt) => (
                  <div key={evt.id} className="activity-feed-item">
                    <div className="activity-feed-top">
                      <span className="activity-actor">
                        {evt.actor_agent_name ?? "System"}
                      </span>
                      <span className="activity-time">{timeAgo(evt.created_at)}</span>
                    </div>
                    <div className="activity-feed-desc">
                      {evt.kind === "created" && "created ticket "}
                      {evt.kind === "status_changed" && `changed status to ${evt.to_value} on `}
                      {evt.kind === "priority_changed" && `set priority to ${evt.to_value} on `}
                      {evt.kind === "assignee_changed" && `assigned to ${evt.to_value} on `}
                      {evt.kind === "queue_changed" && `moved to ${evt.to_value} queue on `}
                      {evt.kind === "sla_breached" && "SLA breached on "}
                      {evt.kind === "sla_warning" && "SLA warning on "}
                      {evt.kind === "rule_applied" && `applied rule "${evt.to_value}" on `}
                      <Link
                        href={`/tickets/${evt.ticket_id}`}
                        className="activity-ticket-link"
                      >
                        #{evt.ticket_id} {evt.ticket_subject ?? ""}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
