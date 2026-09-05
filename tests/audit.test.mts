import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createMember, createOrganizationWithOwner } = await import("../src/lib/agents");
const { countAuditEvents, listAuditEvents, recordEvent } = await import("../src/lib/events");
const { createQueue } = await import("../src/lib/queues");
const {
  createTicket,
  updateAssignee,
  updatePriority,
  updateQueue,
  updateStatus,
} = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Audit", "Ava", "ava@acmeaudit.test");
const globex = await createOrganizationWithOwner("Globex Audit", "Ben", "ben@globexaudit.test");
const charlieId = await createMember(acme.orgId, "Charlie", "charlie@acmeaudit.test");
const financeQueueId = await createQueue(acme.orgId, "Finance");

let t1: number;
let t2: number;

test("listAuditEvents returns comprehensive history across all ticket actions", async () => {
  t1 = await createTicket(acme.orgId, {
    subject: "Audit test ticket 1",
    priority: "low",
    requesterEmail: "client1@test.com",
    actorAgentId: acme.agentId,
  });

  await updateAssignee(acme.orgId, t1, charlieId);
  await recordEvent(acme.orgId, t1, "assignee_changed", {
    actorAgentId: acme.agentId,
    from: "Unassigned",
    to: "Charlie",
  });

  await updatePriority(acme.orgId, t1, "high");
  await recordEvent(acme.orgId, t1, "priority_changed", {
    actorAgentId: acme.agentId,
    from: "low",
    to: "high",
  });

  await updateQueue(acme.orgId, t1, financeQueueId);
  await recordEvent(acme.orgId, t1, "queue_changed", {
    actorAgentId: acme.agentId,
    from: "General",
    to: "Finance",
  });

  await updateStatus(acme.orgId, t1, "in_progress");
  await recordEvent(acme.orgId, t1, "status_changed", {
    actorAgentId: acme.agentId,
    from: "open",
    to: "in_progress",
  });

  t2 = await createTicket(acme.orgId, {
    subject: "Audit test ticket 2",
    priority: "medium",
    requesterEmail: "client2@test.com",
    actorAgentId: charlieId,
  });

  const allEvents = await listAuditEvents(acme.orgId);
  assert.ok(allEvents.length >= 6);

  const totalCount = await countAuditEvents(acme.orgId);
  assert.equal(totalCount, allEvents.length);

  // Assert latest event is at top (descending created_at)
  assert.equal(allEvents[0].ticket_id, t2);
  assert.equal(allEvents[0].ticket_subject, "Audit test ticket 2");
  assert.equal(allEvents[0].actor_agent_name, "Charlie");

  // Verify ticket 1 events contain subjects and descriptions
  const t1Events = allEvents.filter((e) => e.ticket_id === t1);
  assert.ok(t1Events.some((e) => e.kind === "priority_changed"));
  assert.ok(t1Events.some((e) => e.kind === "queue_changed"));
  assert.ok(t1Events.some((e) => e.kind === "assignee_changed"));
  assert.ok(t1Events.some((e) => e.kind === "status_changed"));
});

test("listAuditEvents filters by actor, kind, and ticketId", async () => {
  const charlieEvents = await listAuditEvents(acme.orgId, { actorAgentId: charlieId });
  assert.ok(charlieEvents.length >= 1);
  assert.ok(charlieEvents.every((e) => e.actor_agent_id === charlieId));

  const priorityEvents = await listAuditEvents(acme.orgId, { kind: "priority_changed" });
  assert.ok(priorityEvents.length >= 1);
  assert.ok(priorityEvents.every((e) => e.kind === "priority_changed"));

  const ticket2Events = await listAuditEvents(acme.orgId, { ticketId: t2 });
  assert.ok(ticket2Events.length >= 1);
  assert.ok(ticket2Events.every((e) => e.ticket_id === t2));
});

test("listAuditEvents respects pagination parameters", async () => {
  const page1 = await listAuditEvents(acme.orgId, { limit: 2, offset: 0 });
  assert.equal(page1.length, 2);

  const page2 = await listAuditEvents(acme.orgId, { limit: 2, offset: 2 });
  assert.equal(page2.length, 2);

  assert.notEqual(page1[0].id, page2[0].id);
});

test("audit logs are strictly isolated per tenant", async () => {
  // Create ticket in Globex
  const globexTicket = await createTicket(globex.orgId, {
    subject: "Globex secret ticket",
    priority: "high",
    requesterEmail: "client@globex.test",
    actorAgentId: globex.agentId,
  });

  const globexEvents = await listAuditEvents(globex.orgId);
  assert.equal(globexEvents.length, 1);
  assert.equal(globexEvents[0].ticket_id, globexTicket);

  // Acme audit log must not contain Globex ticket or events
  const acmeEvents = await listAuditEvents(acme.orgId);
  assert.ok(!acmeEvents.some((e) => e.ticket_id === globexTicket));
  assert.ok(!acmeEvents.some((e) => e.org_id === globex.orgId));
});
