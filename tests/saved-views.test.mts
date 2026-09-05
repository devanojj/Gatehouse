import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const {
  countTicketViews,
  createTicket,
  listTickets,
  updateAssignee,
  updateStatus,
} = await import("../src/lib/tickets");
const {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
} = await import("../src/lib/views");

const acme = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

// Acme tickets:
// t1: active, assigned to Ava, priority high
const t1 = await createTicket(acme.orgId, {
  subject: "Server 500 errors",
  description: "Web app returning 500 on checkout",
  priority: "high",
  requesterEmail: "client@test.com",
  actorAgentId: acme.agentId,
});
await updateAssignee(acme.orgId, t1, acme.agentId);

// t2: active, unassigned, priority medium
const t2 = await createTicket(acme.orgId, {
  subject: "General feedback",
  description: "Great new UI",
  priority: "medium",
  requesterEmail: "user@test.com",
  actorAgentId: acme.agentId,
});

// t3: pending_customer (waiting), unassigned, priority low
const t3 = await createTicket(acme.orgId, {
  subject: "Need more logs",
  description: "Waiting for diagnostic output",
  priority: "low",
  requesterEmail: "dev@test.com",
  actorAgentId: acme.agentId,
});
await updateStatus(acme.orgId, t3, "pending_customer");

// t4: closed ticket
const t4 = await createTicket(acme.orgId, {
  subject: "Resolved ticket",
  description: "All done",
  priority: "high",
  requesterEmail: "done@test.com",
  actorAgentId: acme.agentId,
});
await updateStatus(acme.orgId, t4, "closed");

// Globex tickets (to verify isolation)
const g1 = await createTicket(globex.orgId, {
  subject: "Globex urgent",
  description: "Urgent issue in Globex",
  priority: "high",
  requesterEmail: "globex@test.com",
  actorAgentId: globex.agentId,
});
assert.ok(g1 > 0);

test("countTicketViews returns accurate view counts for agent and isolates orgs", async () => {
  const acmeCounts = await countTicketViews(acme.orgId, acme.agentId);
  assert.equal(acmeCounts.all, 4); // 4 total tickets in Acme
  assert.equal(acmeCounts.mine, 1); // t1 is assigned to Ava and active
  assert.equal(acmeCounts.unassigned, 2); // t2 (open) and t3 (pending_customer)
  assert.equal(acmeCounts.waiting, 1); // t3 is pending_customer
  assert.equal(acmeCounts.urgent, 1); // t1 is high priority and active (t4 is closed so excluded)

  const globexCounts = await countTicketViews(globex.orgId, globex.agentId);
  assert.equal(globexCounts.all, 1);
  assert.equal(globexCounts.mine, 0); // g1 is not assigned yet
  assert.equal(globexCounts.unassigned, 1);
  assert.equal(globexCounts.urgent, 1);
});

test("system view filters return expected tickets", async () => {
  // Mine: active assigned to Ava
  const mine = await listTickets(acme.orgId, {
    activeOnly: true,
    assigneeId: acme.agentId,
  });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, t1);

  // Unassigned: active and unassigned
  const unassigned = await listTickets(acme.orgId, {
    activeOnly: true,
    unassigned: true,
  });
  assert.equal(unassigned.length, 2);
  assert.ok(unassigned.some((t) => t.id === t2));
  assert.ok(unassigned.some((t) => t.id === t3));

  // Waiting: status = pending_customer
  const waiting = await listTickets(acme.orgId, {
    status: "pending_customer",
  });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, t3);

  // Urgent: active and priority high
  const urgent = await listTickets(acme.orgId, {
    activeOnly: true,
    priority: "high",
  });
  assert.equal(urgent.length, 1);
  assert.equal(urgent[0].id, t1);
});

test("custom saved views CRUD and tenant isolation", async () => {
  const viewId = await createSavedView(
    acme.orgId,
    acme.agentId,
    "Urgent Checkout Issues",
    "priority=high&q=checkout",
  );

  assert.ok(viewId > 0);

  // Readable inside Acme
  const acmeViews = await listSavedViews(acme.orgId);
  assert.equal(acmeViews.length, 1);
  assert.equal(acmeViews[0].name, "Urgent Checkout Issues");
  assert.equal(acmeViews[0].filters, "priority=high&q=checkout");

  const singleView = await getSavedView(acme.orgId, viewId);
  assert.notEqual(singleView, null);
  assert.equal(singleView?.name, "Urgent Checkout Issues");

  // Not readable or accessible from Globex
  const globexViews = await listSavedViews(globex.orgId);
  assert.equal(globexViews.length, 0);

  const foreignLookup = await getSavedView(globex.orgId, viewId);
  assert.equal(foreignLookup, null);

  // Foreign delete fails
  const foreignDelete = await deleteSavedView(globex.orgId, viewId);
  assert.equal(foreignDelete, false);
  assert.notEqual(await getSavedView(acme.orgId, viewId), null);

  // Own delete succeeds
  const ownDelete = await deleteSavedView(acme.orgId, viewId);
  assert.equal(ownDelete, true);
  assert.equal(await getSavedView(acme.orgId, viewId), null);
});
