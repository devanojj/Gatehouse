import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { execute } = await import("../src/lib/db");
const { listEvents } = await import("../src/lib/events");
const { listNotifications } = await import("../src/lib/notifications");
const { runScheduledTasks } = await import("../src/lib/scheduler");
const { createTicket, getTicket, updateAssignee, updateStatus } = await import(
  "../src/lib/tickets"
);

const acme = await createOrganizationWithOwner("Acme Cron", "Ava", "ava@acmecron.test");
const globex = await createOrganizationWithOwner("Globex Cron", "Ben", "ben@globexcron.test");

test("scheduler identifies overdue first response tickets and flags breaches", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Overdue first response",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });
  await updateAssignee(acme.orgId, ticketId, acme.agentId);

  // Manipulate deadline into the past
  await execute(
    `UPDATE tickets
        SET sla_first_response_due_at = datetime('now', '-30 minutes')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  const result = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(result.sla.firstResponseBreaches, 1);

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.equal(ticket.sla_first_response_breached, 1);
  assert.equal(ticket.sla_breached, 1);

  const events = await listEvents(acme.orgId, ticketId);
  const breachEvent = events.find((e) => e.kind === "sla_breached");
  assert.ok(breachEvent);
  assert.match(breachEvent.to_value ?? "", /First response overdue/);

  const notifs = await listNotifications(acme.orgId, acme.agentId);
  const slaNotif = notifs.find((n) => n.ticket_id === ticketId && n.type === "sla_breached");
  assert.ok(slaNotif);
  assert.match(slaNotif.title, /SLA Breached/);

  // A subsequent run should not re-flag the breach
  const repeatResult = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(repeatResult.sla.firstResponseBreaches, 0);
});

test("scheduler identifies overdue resolution tickets and flags breaches", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Overdue resolution",
    priority: "medium",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });
  await updateAssignee(acme.orgId, ticketId, acme.agentId);

  // Manipulate resolution deadline into the past
  await execute(
    `UPDATE tickets
        SET sla_resolution_due_at = datetime('now', '-10 minutes')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  const result = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(result.sla.resolutionBreaches, 1);

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.equal(ticket.sla_resolution_breached, 1);
  assert.equal(ticket.sla_breached, 1);

  const events = await listEvents(acme.orgId, ticketId);
  const resBreach = events.find((e) => e.kind === "sla_breached" && /Resolution/.test(e.to_value ?? ""));
  assert.ok(resBreach);
});

test("scheduler issues warnings for tickets due within 1 hour", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Nearing breach",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });
  await updateAssignee(acme.orgId, ticketId, acme.agentId);

  // Deadline in 30 minutes
  await execute(
    `UPDATE tickets
        SET sla_first_response_due_at = datetime('now', '+30 minutes')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  const result = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(result.sla.warningsIssued, 1);

  const events = await listEvents(acme.orgId, ticketId);
  const warningEvent = events.find((e) => e.kind === "sla_warning");
  assert.ok(warningEvent);

  const notifs = await listNotifications(acme.orgId, acme.agentId);
  const warningNotif = notifs.find((n) => n.ticket_id === ticketId && n.type === "sla_warning");
  assert.ok(warningNotif);

  // Running again does not duplicate the warning
  const repeatResult = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(repeatResult.sla.warningsIssued, 0);
});

test("scheduler auto-closes resolved tickets older than 7 days", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Stale resolved ticket",
    priority: "low",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  await updateStatus(acme.orgId, ticketId, "resolved");

  // Force resolved_at to 8 days ago
  await execute(
    `UPDATE tickets
        SET resolved_at = datetime('now', '-8 days')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  const result = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(result.autoClosed, 1);

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.equal(ticket.status, "closed");

  const events = await listEvents(acme.orgId, ticketId);
  const closeEvent = events.find(
    (e) => e.kind === "status_changed" && e.from_value === "resolved" && e.to_value === "closed",
  );
  assert.ok(closeEvent);
});

test("scheduler respects orgId filter", async () => {
  // Create overdue ticket in Globex
  const globexTicketId = await createTicket(globex.orgId, {
    subject: "Globex overdue",
    priority: "high",
    requesterEmail: "client@globex.test",
    actorAgentId: globex.agentId,
  });

  await execute(
    `UPDATE tickets
        SET sla_first_response_due_at = datetime('now', '-10 minutes')
      WHERE id = ? AND org_id = ?`,
    [globexTicketId, globex.orgId],
  );

  // Run scheduled tasks filtered to Acme only
  const acmeRun = await runScheduledTasks({ orgId: acme.orgId });
  assert.equal(acmeRun.sla.firstResponseBreaches, 0);

  // Globex ticket is still untouched
  const globexTicket = (await getTicket(globex.orgId, globexTicketId))!;
  assert.equal(globexTicket.sla_first_response_breached, 0);

  // Running across all orgs (or for Globex) catches it
  const globexRun = await runScheduledTasks({ orgId: globex.orgId });
  assert.equal(globexRun.sla.firstResponseBreaches, 1);
});
