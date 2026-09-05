import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { listEvents } = await import("../src/lib/events");
const { createQueue } = await import("../src/lib/queues");
const {
  bulkUpdateTickets,
  createTicket,
  getTicket,
  updateStatus,
} = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Corp", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

const billingQueueId = await createQueue(acme.orgId, "Billing");

const t1 = await createTicket(acme.orgId, {
  subject: "Ticket One",
  description: "Desc One",
  priority: "low",
  requesterEmail: "c1@test.com",
  actorAgentId: acme.agentId,
});

const t2 = await createTicket(acme.orgId, {
  subject: "Ticket Two",
  description: "Desc Two",
  priority: "low",
  requesterEmail: "c2@test.com",
  actorAgentId: acme.agentId,
});

const t3 = await createTicket(acme.orgId, {
  subject: "Ticket Three",
  description: "Desc Three",
  priority: "medium",
  requesterEmail: "c3@test.com",
  actorAgentId: acme.agentId,
});

// A closed ticket
const tClosed = await createTicket(acme.orgId, {
  subject: "Ticket Closed",
  description: "Finished work",
  priority: "medium",
  requesterEmail: "c4@test.com",
  actorAgentId: acme.agentId,
});
await updateStatus(acme.orgId, tClosed, "closed");

// A Globex ticket to test isolation
const g1 = await createTicket(globex.orgId, {
  subject: "Globex Ticket",
  description: "Foreign tenant ticket",
  priority: "low",
  requesterEmail: "foreign@test.com",
  actorAgentId: globex.agentId,
});

test("bulkUpdateTickets changes status and records events", async () => {
  const updated = await bulkUpdateTickets(
    acme.orgId,
    [t1, t2],
    { action: "status", status: "in_progress" },
    { agentId: acme.agentId, role: "owner" },
  );

  assert.equal(updated, 2);

  const ticket1 = await getTicket(acme.orgId, t1);
  const ticket2 = await getTicket(acme.orgId, t2);
  assert.equal(ticket1?.status, "in_progress");
  assert.equal(ticket2?.status, "in_progress");

  // Check event logging
  const events1 = await listEvents(acme.orgId, t1);
  assert.ok(
    events1.some(
      (e) => e.kind === "status_changed" && e.to_value === "in_progress",
    ),
  );
  const events2 = await listEvents(acme.orgId, t2);
  assert.ok(
    events2.some(
      (e) => e.kind === "status_changed" && e.to_value === "in_progress",
    ),
  );
});

test("bulkUpdateTickets changes priority and records events", async () => {
  const updated = await bulkUpdateTickets(
    acme.orgId,
    [t1, t2, t3],
    { action: "priority", priority: "high" },
    { agentId: acme.agentId, role: "member" },
  );

  assert.equal(updated, 3);

  const ticket1 = await getTicket(acme.orgId, t1);
  const ticket3 = await getTicket(acme.orgId, t3);
  assert.equal(ticket1?.priority, "high");
  assert.equal(ticket3?.priority, "high");

  const events1 = await listEvents(acme.orgId, t1);
  assert.ok(
    events1.some((e) => e.kind === "priority_changed" && e.to_value === "high"),
  );
});

test("bulkUpdateTickets assigns and unassigns agents", async () => {
  // Assign to Ava
  const assigned = await bulkUpdateTickets(
    acme.orgId,
    [t1, t2],
    { action: "assignee", assignedAgentId: acme.agentId },
    { agentId: acme.agentId, role: "member" },
  );
  assert.equal(assigned, 2);

  let ticket1 = await getTicket(acme.orgId, t1);
  assert.equal(ticket1?.assigned_agent_id, acme.agentId);

  // Unassign
  const unassigned = await bulkUpdateTickets(
    acme.orgId,
    [t1],
    { action: "assignee", assignedAgentId: null },
    { agentId: acme.agentId, role: "member" },
  );
  assert.equal(unassigned, 1);

  ticket1 = await getTicket(acme.orgId, t1);
  assert.equal(ticket1?.assigned_agent_id, null);
});

test("bulkUpdateTickets moves tickets between queues", async () => {
  const moved = await bulkUpdateTickets(
    acme.orgId,
    [t1, t3],
    { action: "queue", queueId: billingQueueId },
    { agentId: acme.agentId, role: "member" },
  );
  assert.equal(moved, 2);

  const ticket1 = await getTicket(acme.orgId, t1);
  assert.equal(ticket1?.queue_id, billingQueueId);
  assert.equal(ticket1?.queue_name, "Billing");
});

test("bulk actions respect closed ticket restrictions", async () => {
  // A member cannot mutate a closed ticket
  const memberPriorityUpdate = await bulkUpdateTickets(
    acme.orgId,
    [tClosed],
    { action: "priority", priority: "low" },
    { agentId: acme.agentId, role: "member" },
  );
  assert.equal(memberPriorityUpdate, 0);

  const memberStatusUpdate = await bulkUpdateTickets(
    acme.orgId,
    [tClosed],
    { action: "status", status: "open" },
    { agentId: acme.agentId, role: "member" },
  );
  assert.equal(memberStatusUpdate, 0);

  // An owner CAN reopen a closed ticket
  const ownerReopen = await bulkUpdateTickets(
    acme.orgId,
    [tClosed],
    { action: "status", status: "open" },
    { agentId: acme.agentId, role: "owner" },
  );
  assert.equal(ownerReopen, 1);

  const reopenedTicket = await getTicket(acme.orgId, tClosed);
  assert.equal(reopenedTicket?.status, "open");
});

test("bulk actions never mutate tickets from another organization", async () => {
  const gOriginal = await getTicket(globex.orgId, g1);
  assert.equal(gOriginal?.priority, "low");

  // Acme agent attempts to bulk update Globex ticket along with own ticket
  const crossOrgResult = await bulkUpdateTickets(
    acme.orgId,
    [g1, t1],
    { action: "priority", priority: "low" },
    { agentId: acme.agentId, role: "owner" },
  );
  assert.equal(crossOrgResult, 1, "Only Acme's t1 should be updated");

  // Only t1 in Acme could possibly be updated
  const gAfter = await getTicket(globex.orgId, g1);
  assert.equal(gAfter?.priority, "low", "Foreign tenant ticket must remain untouched");

  const t1After = await getTicket(acme.orgId, t1);
  assert.equal(t1After?.priority, "low", "Acme's own ticket should be updated");
});
