import Link from "next/link";

import { seedSampleDataAction } from "@/app/actions/reports";
import { requireSession } from "@/lib/auth";
import { getWorkspaceReport, type TimeRange } from "@/lib/reports";

function formatHours(h: number | null): string {
  if (h === null || h === 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const range: TimeRange =
    params.range === "7d" ||
    params.range === "90d" ||
    params.range === "all"
      ? (params.range as TimeRange)
      : "30d";

  const report = await getWorkspaceReport(session.orgId, range);

  return (
    <div className="container reports-container">
      <div className="reports-header">
        <div>
          <h1 className="page-title">Analytics &amp; Performance Reports</h1>
          <p className="page-subtitle">
            Longitudinal support metrics, SLA adherence, and agent efficiency for {session.orgName}.
          </p>
        </div>

        <div className="reports-header-actions">
          {session.role === "owner" && report.totalCreated === 0 ? (
            <form action={seedSampleDataAction}>
              <button
                type="submit"
                className="btn btn-secondary"
                title="Generates 23 realistic historical tickets spread across the last 30 days"
              >
                Seed Sample Report Data
              </button>
            </form>
          ) : session.role === "owner" ? (
            <form action={seedSampleDataAction}>
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                title="Add sample historical tickets"
              >
                + Add Sample Data
              </button>
            </form>
          ) : null}

          {/* Time range tabs */}
          <div className="range-nav">
            <Link
              href="/reports?range=7d"
              className={`range-tab ${range === "7d" ? "range-tab-active" : ""}`}
            >
              7 Days
            </Link>
            <Link
              href="/reports?range=30d"
              className={`range-tab ${range === "30d" ? "range-tab-active" : ""}`}
            >
              30 Days
            </Link>
            <Link
              href="/reports?range=90d"
              className={`range-tab ${range === "90d" ? "range-tab-active" : ""}`}
            >
              90 Days
            </Link>
            <Link
              href="/reports?range=all"
              className={`range-tab ${range === "all" ? "range-tab-active" : ""}`}
            >
              All Time
            </Link>
          </div>
        </div>
      </div>

      {report.totalCreated === 0 ? (
        <div className="card card-pad text-center py-8">
          <h2 className="card-heading mb-2">No Ticket Data in Selected Range</h2>
          <p className="muted mb-4">
            Create tickets or generate synthetic sample data to view comprehensive support trends and SLA benchmarks.
          </p>
          {session.role === "owner" && (
            <form action={seedSampleDataAction}>
              <button type="submit" className="btn btn-primary">
                Generate 30-Day Sample Data
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
          {/* Top Report KPI Grid */}
          <div className="kpi-grid mb-6">
            <div className="kpi-card">
              <div className="kpi-label">Tickets Created</div>
              <div className="kpi-val">{report.totalCreated}</div>
              <div className="kpi-foot">{report.totalResolved} resolved ({report.resolutionRate}%)</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Resolution Rate</div>
              <div className="kpi-val">{report.resolutionRate}%</div>
              <div className="kpi-foot">
                {report.totalResolved} of {report.totalCreated} tickets
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">First Response SLA</div>
              <div
                className={`kpi-val ${
                  report.firstResponseSlaRate < 90
                    ? "kpi-warn"
                    : report.firstResponseSlaRate === 100
                    ? "kpi-good"
                    : ""
                }`}
              >
                {report.firstResponseSlaRate}%
              </div>
              <div className="kpi-foot">Met target deadline</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Resolution SLA</div>
              <div
                className={`kpi-val ${
                  report.resolutionSlaRate < 85
                    ? "kpi-warn"
                    : report.resolutionSlaRate === 100
                    ? "kpi-good"
                    : ""
                }`}
              >
                {report.resolutionSlaRate}%
              </div>
              <div className="kpi-foot">Resolved within SLA target</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Avg First Response</div>
              <div className="kpi-val">{formatHours(report.avgFirstResponseHours)}</div>
              <div className="kpi-foot">Mean elapsed time</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Avg Resolution Time</div>
              <div className="kpi-val">{formatHours(report.avgResolutionHours)}</div>
              <div className="kpi-foot">Mean elapsed time</div>
            </div>
          </div>

          {/* Daily Activity Volume Trend */}
          {report.trend.length > 0 && (
            <div className="card card-pad mb-6">
              <h2 className="card-heading mb-4">Volume Trends (Created vs Resolved)</h2>
              <div className="trend-table-container">
                <table className="table trend-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Created</th>
                      <th>Resolved</th>
                      <th>SLA Breached</th>
                      <th style={{ width: "40%" }}>Activity Bar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.trend.map((t) => {
                      const maxDaily = Math.max(...report.trend.map((b) => Math.max(b.created, b.resolved, 1)));
                      const createdWidth = Math.round((t.created / maxDaily) * 100);
                      const resolvedWidth = Math.round((t.resolved / maxDaily) * 100);

                      return (
                        <tr key={t.date}>
                          <td className="font-mono text-sm">{t.date}</td>
                          <td className="font-semibold">{t.created}</td>
                          <td className="font-semibold text-teal">{t.resolved}</td>
                          <td>
                            {t.breached > 0 ? (
                              <span className="badge badge-error">{t.breached}</span>
                            ) : (
                              <span className="muted font-mono">0</span>
                            )}
                          </td>
                          <td>
                            <div className="trend-bar-duo">
                              <div
                                className="trend-bar-fill created-fill"
                                style={{ width: `${createdWidth}%` }}
                                title={`${t.created} created`}
                              />
                              <div
                                className="trend-bar-fill resolved-fill"
                                style={{ width: `${resolvedWidth}%` }}
                                title={`${t.resolved} resolved`}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Agent Performance Table */}
          <div className="card card-pad mb-6">
            <h2 className="card-heading mb-4">Agent Performance Leaderboard</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th>Assigned</th>
                  <th>Resolved</th>
                  <th>Avg First Response</th>
                  <th>Avg Resolution</th>
                  <th>SLA Breaches</th>
                </tr>
              </thead>
              <tbody>
                {report.agentPerformance.map((a) => (
                  <tr key={a.agentId}>
                    <td>
                      <div className="font-semibold">{a.name}</div>
                      <div className="muted text-xs">{a.email}</div>
                    </td>
                    <td>
                      <span className="badge badge-neutral capitalize">{a.role}</span>
                    </td>
                    <td className="font-mono">{a.assignedCount}</td>
                    <td className="font-mono font-semibold">{a.resolvedCount}</td>
                    <td className="font-mono">{formatHours(a.avgFirstResponseHours)}</td>
                    <td className="font-mono">{formatHours(a.avgResolutionHours)}</td>
                    <td>
                      {a.slaBreachCount > 0 ? (
                        <span className="badge badge-error">{a.slaBreachCount}</span>
                      ) : (
                        <span className="badge badge-neutral">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Queue & Requester Breakdown */}
          <div className="reports-dual-grid">
            <div className="card card-pad">
              <h2 className="card-heading mb-3">Queue Throughput</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th>Tickets</th>
                    <th>Resolved</th>
                    <th>Breaches</th>
                  </tr>
                </thead>
                <tbody>
                  {report.queuePerformance.map((q) => (
                    <tr key={q.queueId}>
                      <td className="font-semibold">{q.name}</td>
                      <td className="font-mono">{q.totalCount}</td>
                      <td className="font-mono text-teal">{q.resolvedCount}</td>
                      <td>
                        {q.slaBreachedCount > 0 ? (
                          <span className="badge badge-error">{q.slaBreachedCount}</span>
                        ) : (
                          <span className="muted font-mono">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card card-pad">
              <h2 className="card-heading mb-3">Top Requester Accounts</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Requester Email</th>
                    <th>Total Tickets</th>
                    <th>Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topRequesters.map((r) => (
                    <tr key={r.email}>
                      <td className="font-mono text-sm">{r.email}</td>
                      <td className="font-mono font-semibold">{r.count}</td>
                      <td className="font-mono text-teal">{r.resolvedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
