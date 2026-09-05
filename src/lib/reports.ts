import "server-only";

import { execute, insert, query, queryOne } from "./db";
import { type AuditEvent } from "./events";
import { type Priority, type Status, ACTIVE_STATUSES } from "./tickets";

export type TimeRange = "7d" | "30d" | "90d" | "all";

export type DashboardMetrics = {
  activeTickets: number;
  unassignedTickets: number;
  slaBreachedTickets: number;
  slaWarningTickets: number;
  avgFirstResponseHours: number;
  avgResolutionHours: number;
  ticketsToday: number;
  resolvedToday: number;
  ticketsByStatus: Record<Status, number>;
  ticketsByPriority: Record<Priority, number>;
  ticketsByQueue: Array<{ id: number; name: string; count: number }>;
  recentEvents: AuditEvent[];
};

export type TrendBucket = {
  date: string;
  created: number;
  resolved: number;
  breached: number;
};

export type AgentPerformance = {
  agentId: number;
  name: string;
  email: string;
  role: string;
  assignedCount: number;
  resolvedCount: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  slaBreachCount: number;
};

export type QueuePerformance = {
  queueId: number;
  name: string;
  totalCount: number;
  resolvedCount: number;
  slaBreachedCount: number;
};

export type RequesterVolume = {
  email: string;
  count: number;
  resolvedCount: number;
};

export type WorkspaceReport = {
  timeRange: TimeRange;
  totalCreated: number;
  totalResolved: number;
  resolutionRate: number;
  firstResponseSlaRate: number;
  resolutionSlaRate: number;
  avgFirstResponseHours: number;
  avgResolutionHours: number;
  trend: TrendBucket[];
  agentPerformance: AgentPerformance[];
  queuePerformance: QueuePerformance[];
  topRequesters: RequesterVolume[];
};

const ACTIVE_STATUS_LIST = ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ");

/**
 * Computes live operational dashboard metrics for real-time triage.
 */
export async function getDashboardMetrics(
  orgId: number,
): Promise<DashboardMetrics> {
  // 1. Core ticket counters in a single pass
  const summaryRow = await queryOne<{
    active_count: number;
    unassigned_count: number;
    breached_count: number;
    warning_count: number;
    created_today: number;
    resolved_today: number;
    open_count: number;
    in_progress_count: number;
    pending_count: number;
    resolved_count: number;
    closed_count: number;
    high_count: number;
    med_count: number;
    low_count: number;
  }>(
    `SELECT
       SUM(CASE WHEN status IN (${ACTIVE_STATUS_LIST}) THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN status IN (${ACTIVE_STATUS_LIST}) AND assigned_agent_id IS NULL THEN 1 ELSE 0 END) AS unassigned_count,
       SUM(CASE WHEN status IN (${ACTIVE_STATUS_LIST}) AND (sla_breached = 1 OR sla_first_response_breached = 1 OR sla_resolution_breached = 1) THEN 1 ELSE 0 END) AS breached_count,
       SUM(CASE WHEN status IN (${ACTIVE_STATUS_LIST}) AND first_response_at IS NULL AND sla_first_response_due_at BETWEEN datetime('now') AND datetime('now', '+1 hour') THEN 1 ELSE 0 END) AS warning_count,
       SUM(CASE WHEN created_at >= date('now', 'start of day') THEN 1 ELSE 0 END) AS created_today,
       SUM(CASE WHEN resolved_at >= date('now', 'start of day') THEN 1 ELSE 0 END) AS resolved_today,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN status = 'pending_customer' THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
       SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
       SUM(CASE WHEN priority = 'high' AND status IN (${ACTIVE_STATUS_LIST}) THEN 1 ELSE 0 END) AS high_count,
       SUM(CASE WHEN priority = 'medium' AND status IN (${ACTIVE_STATUS_LIST}) THEN 1 ELSE 0 END) AS med_count,
       SUM(CASE WHEN priority = 'low' AND status IN (${ACTIVE_STATUS_LIST}) THEN 1 ELSE 0 END) AS low_count
     FROM tickets
    WHERE org_id = ?`,
    [orgId],
  );

  // 2. Average First Response Duration (in hours) across tickets in the last 30 days
  const frRow = await queryOne<{ avg_hours: number | null }>(
    `SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 24.0) AS avg_hours
       FROM tickets
      WHERE org_id = ?
        AND first_response_at IS NOT NULL
        AND created_at >= datetime('now', '-30 days')`,
    [orgId],
  );

  // 3. Average Resolution Duration (in hours) across resolved/closed tickets in the last 30 days
  const resRow = await queryOne<{ avg_hours: number | null }>(
    `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24.0) AS avg_hours
       FROM tickets
      WHERE org_id = ?
        AND resolved_at IS NOT NULL
        AND created_at >= datetime('now', '-30 days')`,
    [orgId],
  );

  // 4. Queue distribution
  const queueRows = await query<{ id: number; name: string; count: number }>(
    `SELECT q.id, q.name, COUNT(t.id) AS count
       FROM queues q
       LEFT JOIN tickets t
         ON t.queue_id = q.id
        AND t.org_id = q.org_id
        AND t.status IN (${ACTIVE_STATUS_LIST})
      WHERE q.org_id = ?
      GROUP BY q.id, q.name
      ORDER BY count DESC, q.name ASC`,
    [orgId],
  );

  // 5. Recent 8 activity events with ticket subjects
  const recentEvents = await query<AuditEvent>(
    `SELECT e.*, a.name AS actor_agent_name, t.subject AS ticket_subject
       FROM ticket_events e
       LEFT JOIN agents a
         ON a.id = e.actor_agent_id
        AND a.org_id = e.org_id
       LEFT JOIN tickets t
         ON t.id = e.ticket_id
        AND t.org_id = e.org_id
      WHERE e.org_id = ?
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 8`,
    [orgId],
  );

  return {
    activeTickets: Number(summaryRow?.active_count ?? 0),
    unassignedTickets: Number(summaryRow?.unassigned_count ?? 0),
    slaBreachedTickets: Number(summaryRow?.breached_count ?? 0),
    slaWarningTickets: Number(summaryRow?.warning_count ?? 0),
    avgFirstResponseHours: Math.round((Number(frRow?.avg_hours ?? 0)) * 10) / 10,
    avgResolutionHours: Math.round((Number(resRow?.avg_hours ?? 0)) * 10) / 10,
    ticketsToday: Number(summaryRow?.created_today ?? 0),
    resolvedToday: Number(summaryRow?.resolved_today ?? 0),
    ticketsByStatus: {
      open: Number(summaryRow?.open_count ?? 0),
      in_progress: Number(summaryRow?.in_progress_count ?? 0),
      pending_customer: Number(summaryRow?.pending_count ?? 0),
      resolved: Number(summaryRow?.resolved_count ?? 0),
      closed: Number(summaryRow?.closed_count ?? 0),
    },
    ticketsByPriority: {
      high: Number(summaryRow?.high_count ?? 0),
      medium: Number(summaryRow?.med_count ?? 0),
      low: Number(summaryRow?.low_count ?? 0),
    },
    ticketsByQueue: queueRows.map((r) => ({
      id: r.id,
      name: r.name,
      count: Number(r.count),
    })),
    recentEvents,
  };
}

/**
 * Computes deep historical analytics and performance metrics for reports.
 */
export async function getWorkspaceReport(
  orgId: number,
  timeRange: TimeRange = "30d",
): Promise<WorkspaceReport> {
  let dateModifier = "-30 days";
  let daysCount = 30;
  if (timeRange === "7d") {
    dateModifier = "-7 days";
    daysCount = 7;
  } else if (timeRange === "90d") {
    dateModifier = "-90 days";
    daysCount = 90;
  } else if (timeRange === "all") {
    dateModifier = "-365 days";
    daysCount = 365;
  }

  const rangeCondition =
    timeRange === "all" ? "" : `AND created_at >= datetime('now', '${dateModifier}')`;

  // 1. Overall volume & SLA rates
  const statsRow = await queryOne<{
    total_created: number;
    total_resolved: number;
    fr_fulfilled: number;
    fr_total: number;
    res_fulfilled: number;
    res_total: number;
    avg_fr_hours: number | null;
    avg_res_hours: number | null;
  }>(
    `SELECT
       COUNT(*) AS total_created,
       SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS total_resolved,
       SUM(CASE WHEN first_response_at IS NOT NULL AND sla_first_response_breached = 0 THEN 1 ELSE 0 END) AS fr_fulfilled,
       SUM(CASE WHEN first_response_at IS NOT NULL THEN 1 ELSE 0 END) AS fr_total,
       SUM(CASE WHEN resolved_at IS NOT NULL AND sla_resolution_breached = 0 THEN 1 ELSE 0 END) AS res_fulfilled,
       SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS res_total,
       AVG(CASE WHEN first_response_at IS NOT NULL THEN (julianday(first_response_at) - julianday(created_at)) * 24.0 END) AS avg_fr_hours,
       AVG(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at) - julianday(created_at)) * 24.0 END) AS avg_res_hours
     FROM tickets
    WHERE org_id = ? ${rangeCondition}`,
    [orgId],
  );

  const totalCreated = Number(statsRow?.total_created ?? 0);
  const totalResolved = Number(statsRow?.total_resolved ?? 0);
  const resolutionRate =
    totalCreated > 0 ? Math.round((totalResolved / totalCreated) * 100) : 0;

  const frTotal = Number(statsRow?.fr_total ?? 0);
  const frFulfilled = Number(statsRow?.fr_fulfilled ?? 0);
  const firstResponseSlaRate =
    frTotal > 0 ? Math.round((frFulfilled / frTotal) * 100) : 100;

  const resTotal = Number(statsRow?.res_total ?? 0);
  const resFulfilled = Number(statsRow?.res_fulfilled ?? 0);
  const resolutionSlaRate =
    resTotal > 0 ? Math.round((resFulfilled / resTotal) * 100) : 100;

  const avgFirstResponseHours =
    Math.round((Number(statsRow?.avg_fr_hours ?? 0)) * 10) / 10;
  const avgResolutionHours =
    Math.round((Number(statsRow?.avg_res_hours ?? 0)) * 10) / 10;

  // 2. Trend series: Daily bucket aggregation
  const trendLimit = Math.min(daysCount, 30);
  const dailyRows = await query<{
    day: string;
    created_count: number;
    resolved_count: number;
    breached_count: number;
  }>(
    `SELECT
       date(created_at) AS day,
       COUNT(*) AS created_count,
       SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count,
       SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached_count
     FROM tickets
    WHERE org_id = ?
      AND created_at >= date('now', '-${trendLimit} days')
    GROUP BY date(created_at)
    ORDER BY day ASC`,
    [orgId],
  );

  const trend: TrendBucket[] = dailyRows.map((r) => ({
    date: r.day,
    created: Number(r.created_count),
    resolved: Number(r.resolved_count),
    breached: Number(r.breached_count),
  }));

  // 3. Agent Performance
  const agentRows = await query<{
    agent_id: number;
    name: string;
    email: string;
    role: string;
    assigned_count: number;
    resolved_count: number;
    avg_fr_hours: number | null;
    avg_res_hours: number | null;
    sla_breaches: number;
  }>(
    `SELECT
       a.id AS agent_id,
       a.name,
       a.email,
       a.role,
       COUNT(t.id) AS assigned_count,
       SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count,
       AVG(CASE WHEN t.first_response_at IS NOT NULL THEN (julianday(t.first_response_at) - julianday(t.created_at)) * 24.0 END) AS avg_fr_hours,
       AVG(CASE WHEN t.resolved_at IS NOT NULL THEN (julianday(t.resolved_at) - julianday(t.created_at)) * 24.0 END) AS avg_res_hours,
       SUM(CASE WHEN t.sla_breached = 1 THEN 1 ELSE 0 END) AS sla_breaches
     FROM agents a
     LEFT JOIN tickets t
       ON t.assigned_agent_id = a.id
      AND t.org_id = a.org_id
      ${rangeCondition ? rangeCondition.replace(/created_at/g, "t.created_at") : ""}
    WHERE a.org_id = ?
    GROUP BY a.id, a.name, a.email, a.role
    ORDER BY resolved_count DESC, assigned_count DESC`,
    [orgId],
  );

  const agentPerformance: AgentPerformance[] = agentRows.map((a) => ({
    agentId: a.agent_id,
    name: a.name,
    email: a.email,
    role: a.role,
    assignedCount: Number(a.assigned_count),
    resolvedCount: Number(a.resolved_count),
    avgFirstResponseHours:
      a.avg_fr_hours !== null ? Math.round(Number(a.avg_fr_hours) * 10) / 10 : null,
    avgResolutionHours:
      a.avg_res_hours !== null ? Math.round(Number(a.avg_res_hours) * 10) / 10 : null,
    slaBreachCount: Number(a.sla_breaches),
  }));

  // 4. Queue Performance
  const queuePerfRows = await query<{
    queue_id: number;
    name: string;
    total_count: number;
    resolved_count: number;
    breached_count: number;
  }>(
    `SELECT
       q.id AS queue_id,
       q.name,
       COUNT(t.id) AS total_count,
       SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count,
       SUM(CASE WHEN t.sla_breached = 1 THEN 1 ELSE 0 END) AS breached_count
     FROM queues q
     LEFT JOIN tickets t
       ON t.queue_id = q.id
      AND t.org_id = q.org_id
      ${rangeCondition ? rangeCondition.replace(/created_at/g, "t.created_at") : ""}
    WHERE q.org_id = ?
    GROUP BY q.id, q.name
    ORDER BY total_count DESC`,
    [orgId],
  );

  const queuePerformance: QueuePerformance[] = queuePerfRows.map((q) => ({
    queueId: q.queue_id,
    name: q.name,
    totalCount: Number(q.total_count),
    resolvedCount: Number(q.resolved_count),
    slaBreachedCount: Number(q.breached_count),
  }));

  // 5. Top Requesters
  const requesterRows = await query<{
    requester_email: string;
    count: number;
    resolved_count: number;
  }>(
    `SELECT
       requester_email,
       COUNT(*) AS count,
       SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count
     FROM tickets
    WHERE org_id = ?
      AND requester_email IS NOT NULL
      ${rangeCondition}
    GROUP BY requester_email
    ORDER BY count DESC
    LIMIT 6`,
    [orgId],
  );

  const topRequesters: RequesterVolume[] = requesterRows.map((r) => ({
    email: r.requester_email,
    count: Number(r.count),
    resolvedCount: Number(r.resolved_count),
  }));

  return {
    timeRange,
    totalCreated,
    totalResolved,
    resolutionRate,
    firstResponseSlaRate,
    resolutionSlaRate,
    avgFirstResponseHours,
    avgResolutionHours,
    trend,
    agentPerformance,
    queuePerformance,
    topRequesters,
  };
}

/**
 * Seeds realistic synthetic historical tickets, events, and metrics across the past 30 days.
 * Ensures reports immediately have rich, meaningful data to visualize.
 */
export async function seedSampleReportData(
  orgId: number,
  actorAgentId?: number | null,
): Promise<{ createdTickets: number }> {
  // Get available agents and queues for this org
  const agents = await query<{ id: number; name: string }>(
    `SELECT id, name FROM agents WHERE org_id = ? ORDER BY id ASC`,
    [orgId],
  );
  const queues = await query<{ id: number; name: string }>(
    `SELECT id, name FROM queues WHERE org_id = ? ORDER BY is_default DESC, id ASC`,
    [orgId],
  );

  const defaultQueueId = queues[0]?.id ?? null;
  const agentIds = agents.map((a) => a.id);

  const SAMPLE_TICKETS = [
    { subject: "Payment gateway timeout on checkout", priority: "high", requester: "dev@stripe-partner.com", daysAgo: 28, frHours: 0.8, resHours: 4.2, status: "closed" },
    { subject: "How to configure single sign-on with Okta", priority: "medium", requester: "it-admin@enterprise.net", daysAgo: 26, frHours: 2.1, resHours: 18.0, status: "resolved" },
    { subject: "Webhook signature verification error 401", priority: "high", requester: "marcus@api-client.io", daysAgo: 25, frHours: 0.5, resHours: 6.5, status: "resolved" },
    { subject: "Billing invoice address correction", priority: "low", requester: "finance@globex.org", daysAgo: 24, frHours: 5.0, resHours: 48.0, status: "closed" },
    { subject: "Mobile push notifications delayed on iOS 18", priority: "medium", requester: "claire@iosapp.test", daysAgo: 22, frHours: 3.5, resHours: null, status: "in_progress" },
    { subject: "Export data request under GDPR Article 15", priority: "medium", requester: "privacy@legalcorp.com", daysAgo: 20, frHours: 1.5, resHours: 22.0, status: "resolved" },
    { subject: "Database connection pool exhaustion during peak hours", priority: "high", requester: "sre-ops@cloudinfra.net", daysAgo: 18, frHours: 0.4, resHours: 5.0, status: "resolved" },
    { subject: "Custom domain SSL certificate renewal failing", priority: "high", requester: "webmaster@acmepartner.com", daysAgo: 17, frHours: 1.2, resHours: 9.5, status: "closed" }, // SLA breach
    { subject: "Request for higher API rate limits (Tier 3)", priority: "low", requester: "growth@startup.tech", daysAgo: 15, frHours: 4.0, resHours: 30.0, status: "resolved" },
    { subject: "Typography glitches on Safari dark mode", priority: "low", requester: "designer@studio.design", daysAgo: 14, frHours: 8.5, resHours: 65.0, status: "resolved" },
    { subject: "Two-factor SMS verification code not delivered", priority: "high", requester: "elena@usermail.org", daysAgo: 12, frHours: 0.6, resHours: 3.2, status: "closed" },
    { subject: "Audit log export failing with CSV encoding error", priority: "medium", requester: "compliance@financecorp.com", daysAgo: 11, frHours: 2.8, resHours: 19.5, status: "resolved" },
    { subject: "Inbound email forwarding duplicate detection", priority: "medium", requester: "ops@sharedservices.com", daysAgo: 9, frHours: 3.0, resHours: null, status: "pending_customer" },
    { subject: "Cannot delete team member with role 'member'", priority: "low", requester: "hr@company.org", daysAgo: 8, frHours: 6.2, resHours: 45.0, status: "resolved" },
    { subject: "Production latency spike in EU-West cluster", priority: "high", requester: "devops@eupartner.de", daysAgo: 7, frHours: 0.7, resHours: 4.0, status: "resolved" },
    { subject: "Search query containing quotes throws parsing exception", priority: "medium", requester: "support@integration.io", daysAgo: 6, frHours: 1.8, resHours: 14.0, status: "resolved" },
    { subject: "Feedback on the new knowledge base interface", priority: "low", requester: "user@happycustomer.com", daysAgo: 5, frHours: 7.0, resHours: 32.0, status: "resolved" },
    { subject: "Webhook retries flooding endpoint during downtime", priority: "high", requester: "tech@api-integrator.com", daysAgo: 4, frHours: 0.9, resHours: 7.0, status: "resolved" },
    { subject: "Question regarding SLA targets for enterprise tier", priority: "low", requester: "procurement@megacorp.com", daysAgo: 3, frHours: 4.5, resHours: null, status: "in_progress" },
    { subject: "Password reset magic link expired after 10 minutes", priority: "medium", requester: "ava@clienthelp.org", daysAgo: 2, frHours: 1.2, resHours: 8.0, status: "resolved" },
    { subject: "CRON scheduler execution failure notification", priority: "high", requester: "infra@alerting.system", daysAgo: 1, frHours: 0.5, resHours: null, status: "open" },
    { subject: "Ticket search by reference number not matching", priority: "medium", requester: "agent@colleague.net", daysAgo: 1, frHours: null, resHours: null, status: "open" },
    { subject: "Urgent: payment processing webhook down", priority: "high", requester: "billing@shoponline.test", daysAgo: 0, frHours: null, resHours: null, status: "open" },
  ];

  let createdCount = 0;

  for (let i = 0; i < SAMPLE_TICKETS.length; i++) {
    const s = SAMPLE_TICKETS[i];
    const assignedAgentId = agentIds.length > 0 ? agentIds[i % agentIds.length] : null;
    const queueId = queues.length > 0 ? queues[i % queues.length].id : defaultQueueId;

    const createdAtSql = `datetime('now', '-${s.daysAgo} days', '+${(i * 37) % 600} minutes')`;
    const firstRespSql = s.frHours !== null ? `datetime(${createdAtSql}, '+${Math.round(s.frHours * 60)} minutes')` : "NULL";
    const resolvedAtSql = s.resHours !== null ? `datetime(${createdAtSql}, '+${Math.round(s.resHours * 60)} minutes')` : "NULL";

    const isFrBreached = s.frHours !== null && (
      (s.priority === "high" && s.frHours > 1) ||
      (s.priority === "medium" && s.frHours > 4) ||
      (s.priority === "low" && s.frHours > 8)
    ) ? 1 : 0;

    const isResBreached = s.resHours !== null && (
      (s.priority === "high" && s.resHours > 8) ||
      (s.priority === "medium" && s.resHours > 24) ||
      (s.priority === "low" && s.resHours > 72)
    ) ? 1 : 0;

    const slaBreached = (isFrBreached || isResBreached) ? 1 : 0;

    const ticketId = await insert(
      `INSERT INTO tickets
         (org_id, subject, description, priority, requester_email,
          status, queue_id, assigned_agent_id,
          first_response_at, resolved_at,
          sla_first_response_breached, sla_resolution_breached, sla_breached,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?,
               ?, ?, ?,
               ${firstRespSql}, ${resolvedAtSql},
               ?, ?, ?,
               ${createdAtSql}, COALESCE(${resolvedAtSql}, ${firstRespSql}, ${createdAtSql}))`,
      [
        orgId,
        s.subject,
        `Sample customer inquiry body for ticket: ${s.subject}. Provides necessary operational details for reporting metrics.`,
        s.priority,
        s.requester,
        s.status,
        queueId,
        assignedAgentId,
        isFrBreached,
        isResBreached,
        slaBreached,
      ],
    );

    await execute(
      `INSERT INTO ticket_events (org_id, ticket_id, actor_agent_id, kind, from_value, to_value, created_at)
       VALUES (?, ?, ?, 'created', NULL, 'email', ${createdAtSql})`,
      [orgId, ticketId, actorAgentId ?? assignedAgentId],
    );

    if (s.status === "resolved" || s.status === "closed") {
      await execute(
        `INSERT INTO ticket_events (org_id, ticket_id, actor_agent_id, kind, from_value, to_value, created_at)
         VALUES (?, ?, ?, 'status_changed', 'in_progress', 'resolved', ${resolvedAtSql})`,
        [orgId, ticketId, assignedAgentId],
      );
    }

    if (slaBreached) {
      await execute(
        `INSERT INTO ticket_events (org_id, ticket_id, actor_agent_id, kind, from_value, to_value, created_at)
         VALUES (?, ?, NULL, 'sla_breached', NULL, 'SLA target deadline elapsed', COALESCE(${firstRespSql}, ${createdAtSql}))`,
        [orgId, ticketId],
      );
    }

    createdCount++;
  }

  return { createdTickets: createdCount };
}
