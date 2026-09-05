import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createMember, createOrganizationWithOwner } = await import("../src/lib/agents");
const {
  getDashboardMetrics,
  getWorkspaceReport,
  seedSampleReportData,
} = await import("../src/lib/reports");
const { createTicket, markFirstResponse, updateStatus } = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Reports", "Ava", "ava@acmereports.test");
const globex = await createOrganizationWithOwner("Globex Reports", "Ben", "ben@globexreports.test");
await createMember(acme.orgId, "Charlie", "charlie@acmereports.test");

test("getDashboardMetrics returns accurate operational counters", async () => {
  const initial = await getDashboardMetrics(acme.orgId);
  assert.equal(initial.activeTickets, 0);
  assert.equal(initial.unassignedTickets, 0);

  await createTicket(acme.orgId, {
    subject: "Active unassigned issue",
    priority: "high",
    requesterEmail: "user1@test.com",
    actorAgentId: acme.agentId,
  });

  const t2 = await createTicket(acme.orgId, {
    subject: "Active assigned issue",
    priority: "medium",
    requesterEmail: "user2@test.com",
    assignedAgentId: acme.agentId,
    actorAgentId: acme.agentId,
  });

  await markFirstResponse(acme.orgId, t2);
  await updateStatus(acme.orgId, t2, "in_progress");

  const t3 = await createTicket(acme.orgId, {
    subject: "Resolved ticket",
    priority: "low",
    requesterEmail: "user3@test.com",
    actorAgentId: acme.agentId,
  });
  await updateStatus(acme.orgId, t3, "resolved");

  const metrics = await getDashboardMetrics(acme.orgId);
  assert.equal(metrics.activeTickets, 2);
  assert.equal(metrics.unassignedTickets, 1);
  assert.equal(metrics.ticketsByStatus.open, 1);
  assert.equal(metrics.ticketsByStatus.resolved, 1);
  assert.equal(metrics.ticketsByPriority.high, 1);
  assert.equal(metrics.ticketsByPriority.medium, 1);
  assert.ok(metrics.recentEvents.length >= 3);
});

test("getWorkspaceReport aggregates metrics and handles time ranges", async () => {
  const report30d = await getWorkspaceReport(acme.orgId, "30d");
  assert.equal(report30d.totalCreated, 3);
  assert.equal(report30d.totalResolved, 1);
  assert.equal(report30d.resolutionRate, 33);
  assert.ok(report30d.trend.length >= 1);
  assert.ok(report30d.queuePerformance.length >= 1);

  const report7d = await getWorkspaceReport(acme.orgId, "7d");
  assert.equal(report7d.totalCreated, 3);

  // Globex should see 0
  const globexReport = await getWorkspaceReport(globex.orgId, "30d");
  assert.equal(globexReport.totalCreated, 0);
  assert.equal(globexReport.totalResolved, 0);
});

test("seedSampleReportData generates rich historical metrics within tenant", async () => {
  const seedResult = await seedSampleReportData(acme.orgId, acme.agentId);
  assert.ok(seedResult.createdTickets >= 20);

  const fullReport = await getWorkspaceReport(acme.orgId, "30d");
  assert.ok(fullReport.totalCreated >= 23);
  assert.ok(fullReport.totalResolved >= 15);
  assert.ok(fullReport.resolutionRate > 50);
  assert.ok(fullReport.trend.length >= 5);
  assert.ok(fullReport.agentPerformance.length >= 1);
  assert.ok(fullReport.topRequesters.length >= 3);

  // Globex metrics remain completely unpolluted
  const globexMetrics = await getDashboardMetrics(globex.orgId);
  assert.equal(globexMetrics.activeTickets, 0);
  const globexReport = await getWorkspaceReport(globex.orgId, "30d");
  assert.equal(globexReport.totalCreated, 0);
});
