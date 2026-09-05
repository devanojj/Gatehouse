import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createMember, createOrganizationWithOwner } = await import("../src/lib/agents");
const {
  countUnreadNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = await import("../src/lib/notifications");
const { createTicket } = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Alerts", "Ava", "ava@acmealerts.test");
const bobId = await createMember(acme.orgId, "Bob", "bob@acmealerts.test");

const ticketId = await createTicket(acme.orgId, {
  subject: "Database latency",
  priority: "high",
  requesterEmail: "client@test.com",
  actorAgentId: acme.agentId,
});

test("createNotification inserts and lists notifications across supported types", async () => {
  const n1 = await createNotification(acme.orgId, {
    agentId: acme.agentId,
    ticketId,
    type: "ticket_assigned",
    title: "Ticket assigned",
    body: "You have been assigned to ticket #1",
  });

  const n2 = await createNotification(acme.orgId, {
    agentId: acme.agentId,
    ticketId,
    type: "customer_reply",
    title: "Customer replied",
    body: "Client sent a response on ticket #1",
  });

  const n3 = await createNotification(acme.orgId, {
    agentId: acme.agentId,
    ticketId,
    type: "sla_warning",
    title: "SLA Warning",
    body: "Response due in under 1 hour",
  });

  const n4 = await createNotification(acme.orgId, {
    agentId: acme.agentId,
    ticketId,
    type: "sla_breached",
    title: "SLA Breached",
    body: "Ticket missed response SLA",
  });

  assert.ok(n1 > 0);
  assert.ok(n2 > n1);
  assert.ok(n3 > n2);
  assert.ok(n4 > n3);

  const notifications = await listNotifications(acme.orgId, acme.agentId);
  assert.equal(notifications.length, 4);
  assert.equal(notifications[0].id, n4, "most recent notification first");
  assert.equal(notifications[0].type, "sla_breached");
  assert.equal(notifications[0].read_at, null);
});

test("countUnreadNotifications accurately reflects unread status", async () => {
  const unreadCount = await countUnreadNotifications(acme.orgId, acme.agentId);
  assert.equal(unreadCount, 4);

  const bobUnread = await countUnreadNotifications(acme.orgId, bobId);
  assert.equal(bobUnread, 0);
});

test("markNotificationRead marks a single notification as read", async () => {
  const list = await listNotifications(acme.orgId, acme.agentId);
  const target = list[0];

  const marked = await markNotificationRead(acme.orgId, acme.agentId, target.id);
  assert.equal(marked, true);

  const unreadCount = await countUnreadNotifications(acme.orgId, acme.agentId);
  assert.equal(unreadCount, 3);

  const unreadOnly = await listNotifications(acme.orgId, acme.agentId, { unreadOnly: true });
  assert.equal(unreadOnly.length, 3);
  assert.ok(!unreadOnly.some((n) => n.id === target.id));
});

test("agents within the same organization cannot mark each other's notifications", async () => {
  const list = await listNotifications(acme.orgId, acme.agentId, { unreadOnly: true });
  const target = list[0];

  // Bob attempts to mark Ava's notification
  const markedByBob = await markNotificationRead(acme.orgId, bobId, target.id);
  assert.equal(markedByBob, false);

  const unreadCount = await countUnreadNotifications(acme.orgId, acme.agentId);
  assert.equal(unreadCount, 3);
});

test("markAllNotificationsRead clears all unread notifications for the agent", async () => {
  await markAllNotificationsRead(acme.orgId, acme.agentId);

  const unreadCount = await countUnreadNotifications(acme.orgId, acme.agentId);
  assert.equal(unreadCount, 0);

  const unreadOnly = await listNotifications(acme.orgId, acme.agentId, { unreadOnly: true });
  assert.equal(unreadOnly.length, 0);

  const all = await listNotifications(acme.orgId, acme.agentId);
  assert.equal(all.length, 4);
  assert.ok(all.every((n) => n.read_at !== null));
});
