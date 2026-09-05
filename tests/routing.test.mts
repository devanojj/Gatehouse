import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createMember, createOrganizationWithOwner } = await import("../src/lib/agents");
const { listEvents } = await import("../src/lib/events");
const { listNotifications } = await import("../src/lib/notifications");
const { createQueue } = await import("../src/lib/queues");
const {
  createRoutingRule,
  deleteRoutingRule,
  getRoutingRule,
  listRoutingRules,
  matchesCondition,
  reorderRoutingRules,
  updateRoutingRule,
} = await import("../src/lib/routing");
const { createTicket, getTicket } = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Routing", "Ava", "ava@acmerouting.test");
const bobId = await createMember(acme.orgId, "Bob Support", "bob@acmerouting.test");
const billingQueueId = await createQueue(acme.orgId, "Billing");
const techQueueId = await createQueue(acme.orgId, "Technical Support");

test("matchesCondition evaluates string operators correctly", () => {
  assert.equal(matchesCondition("Invoice #1234 payment", "contains", "invoice"), true);
  assert.equal(matchesCondition("General inquiry", "contains", "invoice"), false);
  assert.equal(matchesCondition("vip@enterprise.com", "ends_with", "@enterprise.com"), true);
  assert.equal(matchesCondition("vip@other.com", "ends_with", "@enterprise.com"), false);
  assert.equal(matchesCondition("Urgent: server down", "starts_with", "urgent:"), true);
  assert.equal(matchesCondition("Server down: urgent", "starts_with", "urgent:"), false);
  assert.equal(matchesCondition("Refund", "equals", "refund"), true);
  assert.equal(matchesCondition("Refund please", "equals", "refund"), false);
});

test("routing rules CRUD and position management", async () => {
  const rule1Id = await createRoutingRule(acme.orgId, {
    name: "VIP Enterprise Routing",
    description: "Route all enterprise clients to Bob with High priority",
    matchField: "requester_email",
    matchOperator: "ends_with",
    matchValue: "@enterprise.com",
    targetAgentId: bobId,
    targetPriority: "high",
  });

  const rule2Id = await createRoutingRule(acme.orgId, {
    name: "Billing Inquiries",
    matchField: "subject",
    matchOperator: "contains",
    matchValue: "invoice",
    targetQueueId: billingQueueId,
    targetPriority: "medium",
  });

  const rule3Id = await createRoutingRule(acme.orgId, {
    name: "Crash Reports",
    matchField: "body",
    matchOperator: "contains",
    matchValue: "fatal exception",
    targetQueueId: techQueueId,
    targetPriority: "high",
  });

  let rules = await listRoutingRules(acme.orgId);
  assert.equal(rules.length, 3);
  assert.equal(rules[0].id, rule1Id);
  assert.equal(rules[0].position, 0);
  assert.equal(rules[1].id, rule2Id);
  assert.equal(rules[1].position, 1);
  assert.equal(rules[2].id, rule3Id);
  assert.equal(rules[2].position, 2);

  // Update rule 2
  const updated = await updateRoutingRule(acme.orgId, rule2Id, {
    name: "Billing and Invoices",
    isActive: false,
  });
  assert.equal(updated, true);

  const rule2 = (await getRoutingRule(acme.orgId, rule2Id))!;
  assert.equal(rule2.name, "Billing and Invoices");
  assert.equal(rule2.is_active, 0);

  // Reorder rules: swap rule 1 and rule 3
  await reorderRoutingRules(acme.orgId, [rule3Id, rule1Id, rule2Id]);
  rules = await listRoutingRules(acme.orgId);
  assert.equal(rules[0].id, rule3Id);
  assert.equal(rules[1].id, rule1Id);

  // Delete rule
  const deleted = await deleteRoutingRule(acme.orgId, rule3Id);
  assert.equal(deleted, true);

  rules = await listRoutingRules(acme.orgId);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, rule1Id);
  assert.equal(rules[0].position, 0, "positions should defragment");
});

test("createTicket automatically evaluates active routing rules", async () => {
  // Rule 1: VIP email -> assigned to Bob, priority high
  const ticketId = await createTicket(acme.orgId, {
    subject: "Need enterprise contract renewal",
    description: "Please get back to us.",
    priority: "low", // caller specified low, rule should override to high
    requesterEmail: "cto@enterprise.com",
    actorAgentId: acme.agentId,
  });

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.equal(ticket.priority, "high", "routing rule should have escalated priority");
  assert.equal(ticket.assigned_agent_id, bobId, "routing rule should have assigned ticket to Bob");

  // Verify rule_applied event recorded
  const events = await listEvents(acme.orgId, ticketId);
  const ruleEvent = events.find((e) => e.kind === "rule_applied");
  assert.ok(ruleEvent);
  assert.equal(ruleEvent.to_value, "VIP Enterprise Routing");

  // Verify notification was sent to Bob
  const notifs = await listNotifications(acme.orgId, bobId);
  const assignNotif = notifs.find((n) => n.ticket_id === ticketId && n.type === "ticket_assigned");
  assert.ok(assignNotif);
  assert.match(assignNotif.body, /VIP Enterprise Routing/);
});

test("inactive rules are skipped during ticket ingestion", async () => {
  // Billing Invoices rule was set to is_active = 0 above
  const ticketId = await createTicket(acme.orgId, {
    subject: "Question about our invoice",
    priority: "low",
    requesterEmail: "user@client.test",
    actorAgentId: acme.agentId,
  });

  const ticket = (await getTicket(acme.orgId, ticketId))!;
  assert.notEqual(ticket.queue_id, billingQueueId, "disabled rule should not route ticket");
  assert.equal(ticket.priority, "low", "disabled rule should not change priority");

  const events = await listEvents(acme.orgId, ticketId);
  assert.equal(events.some((e) => e.kind === "rule_applied"), false);
});
