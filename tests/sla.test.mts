import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { execute } = await import("../src/lib/db");
const { listEvents } = await import("../src/lib/events");
const { toPortalTicket } = await import("../src/lib/portal");
const {
  evaluateTicketSla,
  listSlaTargets,
  updateSlaTargets,
} = await import("../src/lib/sla");
const {
  createTicket,
  getTicket,
  markFirstResponse,
  updatePriority,
  updateStatus,
} = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme SLA", "Ava", "ava@acmesla.test");

test("tickets are created with default SLA deadlines based on priority", async () => {
  const highTicketId = await createTicket(acme.orgId, {
    subject: "High priority outage",
    priority: "high",
    requesterEmail: "user1@test.com",
    actorAgentId: acme.agentId,
  });

  const highTicket = (await getTicket(acme.orgId, highTicketId))!;
  assert.ok(highTicket.sla_policy_id, "policy id should be attached");
  assert.ok(highTicket.sla_first_response_due_at);
  assert.ok(highTicket.sla_resolution_due_at);
  assert.equal(highTicket.sla_first_response_breached, 0);
  assert.equal(highTicket.sla_resolution_breached, 0);
  assert.equal(highTicket.sla_breached, 0);

  // High priority default: 1h response, 8h resolution
  const highCreated = new Date(highTicket.created_at.replace(" ", "T") + "Z").getTime();
  const highRespDue = new Date(highTicket.sla_first_response_due_at.replace(" ", "T") + "Z").getTime();
  const highResDue = new Date(highTicket.sla_resolution_due_at.replace(" ", "T") + "Z").getTime();

  assert.equal(Math.round((highRespDue - highCreated) / (3600 * 1000)), 1);
  assert.equal(Math.round((highResDue - highCreated) / (3600 * 1000)), 8);

  // Medium priority default: 4h response, 24h resolution
  const medTicketId = await createTicket(acme.orgId, {
    subject: "Medium priority question",
    priority: "medium",
    requesterEmail: "user2@test.com",
    actorAgentId: acme.agentId,
  });
  const medTicket = (await getTicket(acme.orgId, medTicketId))!;
  const medCreated = new Date(medTicket.created_at.replace(" ", "T") + "Z").getTime();
  const medRespDue = new Date(medTicket.sla_first_response_due_at!.replace(" ", "T") + "Z").getTime();
  assert.equal(Math.round((medRespDue - medCreated) / (3600 * 1000)), 4);
});

test("markFirstResponse stamps fulfilled without breach when responding on time", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Prompt assistance",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  const marked = await markFirstResponse(acme.orgId, ticketId);
  assert.equal(marked, true);

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.ok(ticket.first_response_at);
  assert.equal(ticket.sla_first_response_breached, 0);
  assert.equal(ticket.sla_breached, 0);

  const evaluation = evaluateTicketSla(ticket);
  assert.equal(evaluation.firstResponse.status, "fulfilled");
  assert.equal(evaluation.firstResponse.breached, false);
});

test("markFirstResponse flags breach when responding past the deadline", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Late assistance",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  // Force deadline to be 2 hours in the past
  await execute(
    `UPDATE tickets
        SET sla_first_response_due_at = datetime('now', '-2 hours')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  const marked = await markFirstResponse(acme.orgId, ticketId);
  assert.equal(marked, true);

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.ok(ticket.first_response_at);
  assert.equal(ticket.sla_first_response_breached, 1);
  assert.equal(ticket.sla_breached, 1);

  const events = await listEvents(acme.orgId, ticketId);
  const breachEvent = events.find((e) => e.kind === "sla_breached");
  assert.ok(breachEvent);
  assert.match(breachEvent.to_value ?? "", /First response/);

  const evaluation = evaluateTicketSla(ticket);
  assert.equal(evaluation.firstResponse.status, "breached");
  assert.equal(evaluation.firstResponse.breached, true);
});

test("resolving past resolution deadline flags breach", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Slow fix",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  // Force resolution deadline into the past
  await execute(
    `UPDATE tickets
        SET sla_resolution_due_at = datetime('now', '-1 hours')
      WHERE id = ? AND org_id = ?`,
    [ticketId, acme.orgId],
  );

  await updateStatus(acme.orgId, ticketId, "resolved");

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.equal(ticket.status, "resolved");
  assert.ok(ticket.resolved_at);
  assert.equal(ticket.sla_resolution_breached, 1);
  assert.equal(ticket.sla_breached, 1);

  const events = await listEvents(acme.orgId, ticketId);
  const breachEvent = events.find((e) => e.kind === "sla_breached");
  assert.ok(breachEvent);
  assert.match(breachEvent.to_value ?? "", /Resolution/);
});

test("changing priority recalculates SLA deadlines for open tickets", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Escalated issue",
    priority: "low",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  const initialTicket = (await getTicket(acme.orgId, ticketId))!;
  const oldRespDue = initialTicket.sla_first_response_due_at!;

  // Escalate to high
  await updatePriority(acme.orgId, ticketId, "high");

  const updatedTicket = (await getTicket(acme.orgId, ticketId))!;
  assert.notEqual(updatedTicket.sla_first_response_due_at, oldRespDue);

  const created = new Date(updatedTicket.created_at.replace(" ", "T") + "Z").getTime();
  const newRespDue = new Date(updatedTicket.sla_first_response_due_at!.replace(" ", "T") + "Z").getTime();
  // High response is 1 hour
  assert.equal(Math.round((newRespDue - created) / (3600 * 1000)), 1);
});

test("custom SLA targets update policy and affect newly created tickets", async () => {
  await updateSlaTargets(acme.orgId, [
    { priority: "high", firstResponseHours: 2, resolutionHours: 12 },
    { priority: "medium", firstResponseHours: 6, resolutionHours: 36 },
    { priority: "low", firstResponseHours: 12, resolutionHours: 96 },
  ]);

  const targets = await listSlaTargets(acme.orgId);
  const highTarget = targets.find((t) => t.priority === "high");
  assert.equal(highTarget?.first_response_hours, 2);
  assert.equal(highTarget?.resolution_hours, 12);

  const newTicketId = await createTicket(acme.orgId, {
    subject: "Ticket under new SLA targets",
    priority: "high",
    requesterEmail: "user@test.com",
    actorAgentId: acme.agentId,
  });

  const newTicket = (await getTicket(acme.orgId, newTicketId))!;
  const created = new Date(newTicket.created_at.replace(" ", "T") + "Z").getTime();
  const respDue = new Date(newTicket.sla_first_response_due_at!.replace(" ", "T") + "Z").getTime();
  const resDue = new Date(newTicket.sla_resolution_due_at!.replace(" ", "T") + "Z").getTime();

  assert.equal(Math.round((respDue - created) / (3600 * 1000)), 2);
  assert.equal(Math.round((resDue - created) / (3600 * 1000)), 12);
});

test("toPortalTicket completely strips all SLA fields", async () => {
  const ticketId = await createTicket(acme.orgId, {
    subject: "Secret SLA data",
    priority: "high",
    requesterEmail: "customer@test.com",
    actorAgentId: acme.agentId,
  });

  const agentTicket = (await getTicket(acme.orgId, ticketId))!;
  const portalTicket = toPortalTicket(agentTicket) as unknown as Record<string, unknown>;

  assert.equal(portalTicket.sla_policy_id, undefined);
  assert.equal(portalTicket.sla_first_response_due_at, undefined);
  assert.equal(portalTicket.sla_resolution_due_at, undefined);
  assert.equal(portalTicket.sla_first_response_breached, undefined);
  assert.equal(portalTicket.sla_resolution_breached, undefined);
  assert.equal(portalTicket.sla_breached, undefined);
});
