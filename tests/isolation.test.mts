import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { createComment, listComments } = await import("../src/lib/comments");
const { countAuditEvents, listAuditEvents, listEvents, recordEvent } = await import("../src/lib/events");
const {
  bulkUpdateTickets,
  countTicketsByStatus,
  countTicketViews,
  createTicket,
  findOpenTicketByRequester,
  getTicket,
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
const {
  createArticle,
  deleteArticle,
  getArticle,
  getArticleBySlug,
  listArticles,
  updateArticle,
} = await import("../src/lib/articles");
const {
  createCategory,
  deleteCategory,
  getCategory,
  getCategoryBySlug,
  listCategories,
  updateCategory,
} = await import("../src/lib/kb-categories");
const {
  getDefaultSlaPolicy,
  listSlaTargets,
  updateSlaTargets,
} = await import("../src/lib/sla");
const {
  countUnreadNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = await import("../src/lib/notifications");
const {
  createRoutingRule,
  deleteRoutingRule,
  getRoutingRule,
  listRoutingRules,
  updateRoutingRule,
} = await import("../src/lib/routing");
const {
  getDashboardMetrics,
  getWorkspaceReport,
} = await import("../src/lib/reports");

const REQUESTER = "priya@client.test";

const acme = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

const ticketId = await createTicket(acme.orgId, {
  subject: "Card declined",
  description: "Payment fails at checkout.",
  priority: "high",
  requesterEmail: REQUESTER,
  actorAgentId: acme.agentId,
});

await createComment(acme.orgId, ticketId, acme.agentId, "internal", "Looks like a gateway timeout.", {
  authorEmail: "ava@acme.test",
});

/*
 * Every case below is the same shape: Globex holds a real id belonging to Acme
 * — the situation a hand-crafted POST or an edited URL produces — and must come
 * away with nothing rather than with Acme's row.
 */

test("a ticket id from another org does not resolve", async () => {
  assert.equal(await getTicket(globex.orgId, ticketId), null);
});

test("another org's tickets are absent from the list and the counts", async () => {
  assert.deepEqual(await listTickets(globex.orgId), []);
  assert.equal((await countTicketsByStatus(globex.orgId)).all, 0);
});

test("comments are not readable across orgs", async () => {
  assert.equal((await listComments(acme.orgId, ticketId)).length, 1);
  assert.deepEqual(await listComments(globex.orgId, ticketId), []);
});

test("events are not readable across orgs", async () => {
  const own = await listEvents(acme.orgId, ticketId);
  assert.equal(own.length, 1);
  assert.equal(own[0].kind, "created");

  assert.deepEqual(await listEvents(globex.orgId, ticketId), []);
});

test("an event cannot be written onto another org's ticket", async () => {
  const recorded = await recordEvent(globex.orgId, ticketId, "status_changed", {
    actorAgentId: globex.agentId,
    from: "open",
    to: "closed",
  });

  assert.equal(recorded, false, "the insert should have matched no ticket");
  assert.equal((await listEvents(acme.orgId, ticketId)).length, 1);
});

test("a status change from another org touches nothing", async () => {
  await updateStatus(globex.orgId, ticketId, "closed");

  const ticket = await getTicket(acme.orgId, ticketId);
  assert.equal(ticket?.status, "open");
});

test("an agent from another org cannot be assigned", async () => {
  await updateAssignee(acme.orgId, ticketId, globex.agentId);

  const ticket = await getTicket(acme.orgId, ticketId);
  assert.equal(
    ticket?.assigned_agent_id,
    null,
    "a foreign agent id must become NULL, not an assignment",
  );
});

test("inbound threading does not reach across orgs", async () => {
  assert.notEqual(await findOpenTicketByRequester(acme.orgId, REQUESTER), null);
  assert.equal(await findOpenTicketByRequester(globex.orgId, REQUESTER), null);
});

test("an event actor from another org is dropped rather than recorded", async () => {
  await recordEvent(acme.orgId, ticketId, "priority_changed", {
    actorAgentId: globex.agentId,
    from: "high",
    to: "low",
  });

  const events = await listEvents(acme.orgId, ticketId);
  const latest = events[events.length - 1];

  assert.equal(latest.kind, "priority_changed");
  assert.equal(latest.actor_agent_id, null, "a foreign actor must not be stored");
});

test("countTicketViews does not leak ticket counts across orgs", async () => {
  const acmeViews = await countTicketViews(acme.orgId, acme.agentId);
  assert.equal(acmeViews.all, 1);

  const globexViews = await countTicketViews(globex.orgId, globex.agentId);
  assert.equal(globexViews.all, 0);
});

test("bulk updates do not mutate or record events across orgs", async () => {
  const updated = await bulkUpdateTickets(
    globex.orgId,
    [ticketId],
    { action: "status", status: "closed" },
    { agentId: globex.agentId, role: "owner" },
  );

  assert.equal(updated, 0, "updating another org's ticket in bulk touches nothing");
  const ticket = await getTicket(acme.orgId, ticketId);
  assert.equal(ticket?.status, "open");
});

test("saved views are isolated per organization", async () => {
  const viewId = await createSavedView(
    acme.orgId,
    acme.agentId,
    "Acme View",
    "priority=high",
  );

  assert.equal(await getSavedView(globex.orgId, viewId), null);
  assert.deepEqual(await listSavedViews(globex.orgId), []);
  assert.equal(await deleteSavedView(globex.orgId, viewId), false);
});

test("knowledge base categories are isolated per organization", async () => {
  const catId = await createCategory(acme.orgId, {
    name: "Acme Private",
    slug: "acme-private",
  });

  assert.equal(await getCategory(globex.orgId, catId), null);
  assert.equal(await getCategoryBySlug(globex.orgId, "acme-private"), null);
  assert.deepEqual(await listCategories(globex.orgId), []);
  assert.equal(await updateCategory(globex.orgId, catId, { name: "Hacked" }), false);
  assert.equal(await deleteCategory(globex.orgId, catId), false);
});

test("articles and search are isolated per organization", async () => {
  const artId = await createArticle(acme.orgId, {
    title: "Confidential Strategy",
    slug: "confidential-strategy",
    body: "Acme proprietary internal roadmap details.",
    status: "published",
  });

  assert.equal(await getArticle(globex.orgId, artId), null);
  assert.equal(await getArticleBySlug(globex.orgId, "confidential-strategy"), null);
  assert.deepEqual(await listArticles(globex.orgId), []);

  // Searching in Globex must return 0 results for Acme's articles
  const searchResults = await listArticles(globex.orgId, { search: "roadmap" });
  assert.equal(searchResults.length, 0);

  assert.equal(await updateArticle(globex.orgId, artId, { title: "Defaced" }), false);
  assert.equal(await deleteArticle(globex.orgId, artId), false);
});

test("SLA policies and targets are isolated per organization", async () => {
  const acmePolicy = await getDefaultSlaPolicy(acme.orgId);
  const globexPolicy = await getDefaultSlaPolicy(globex.orgId);

  assert.notEqual(acmePolicy.id, globexPolicy.id);
  assert.equal(acmePolicy.org_id, acme.orgId);
  assert.equal(globexPolicy.org_id, globex.orgId);

  // Updating Globex targets does not affect Acme targets
  await updateSlaTargets(globex.orgId, [
    { priority: "high", firstResponseHours: 2, resolutionHours: 10 },
  ]);

  const acmeTargets = await listSlaTargets(acme.orgId);
  const acmeHigh = acmeTargets.find((t) => t.priority === "high");
  assert.equal(acmeHigh?.first_response_hours, 1); // default is 1, unchanged

  const globexTargets = await listSlaTargets(globex.orgId);
  const globexHigh = globexTargets.find((t) => t.priority === "high");
  assert.equal(globexHigh?.first_response_hours, 2);
  assert.equal(globexHigh?.resolution_hours, 10);
});

test("notifications are strictly isolated per organization and agent", async () => {
  const notifId = await createNotification(acme.orgId, {
    agentId: acme.agentId,
    ticketId,
    type: "ticket_assigned",
    title: "Assigned to you",
    body: "You were assigned to ticket.",
  });

  // Globex agent sees none of Acme's notifications
  assert.deepEqual(await listNotifications(globex.orgId, globex.agentId), []);
  assert.equal(await countUnreadNotifications(globex.orgId, globex.agentId), 0);

  // Globex cannot mark Acme notification as read
  const marked = await markNotificationRead(globex.orgId, globex.agentId, notifId);
  assert.equal(marked, false);

  // Acme unread count is still 1
  assert.equal(await countUnreadNotifications(acme.orgId, acme.agentId), 1);

  // Globex markAll does not clear Acme unread count
  await markAllNotificationsRead(globex.orgId, globex.agentId);
  assert.equal(await countUnreadNotifications(acme.orgId, acme.agentId), 1);
});

test("routing rules are isolated per organization", async () => {
  const ruleId = await createRoutingRule(acme.orgId, {
    name: "Acme VIP Routing",
    matchField: "subject",
    matchOperator: "contains",
    matchValue: "Urgent",
    targetPriority: "high",
  });

  // Globex cannot list Acme's rules
  assert.deepEqual(await listRoutingRules(globex.orgId), []);
  assert.equal(await getRoutingRule(globex.orgId, ruleId), null);

  // Globex cannot update or delete Acme's rule
  assert.equal(await updateRoutingRule(globex.orgId, ruleId, { name: "Compromised" }), false);
  assert.equal(await deleteRoutingRule(globex.orgId, ruleId), false);

  // Acme rule remains untouched
  const acmeRules = await listRoutingRules(acme.orgId);
  assert.equal(acmeRules.length, 1);
  assert.equal(acmeRules[0].name, "Acme VIP Routing");
});

test("dashboard metrics and reports are isolated per organization", async () => {
  const globexMetrics = await getDashboardMetrics(globex.orgId);
  assert.equal(globexMetrics.activeTickets, 0);
  assert.equal(globexMetrics.unassignedTickets, 0);
  assert.equal(globexMetrics.recentEvents.length, 0);

  const acmeMetrics = await getDashboardMetrics(acme.orgId);
  assert.ok(acmeMetrics.activeTickets >= 1);

  const globexReport = await getWorkspaceReport(globex.orgId, "all");
  assert.equal(globexReport.totalCreated, 0);
  assert.equal(globexReport.totalResolved, 0);

  const acmeReport = await getWorkspaceReport(acme.orgId, "all");
  assert.ok(acmeReport.totalCreated >= 1);
});

test("audit logs are isolated per organization", async () => {
  const acmeAudit = await listAuditEvents(acme.orgId);
  assert.ok(acmeAudit.length >= 1);
  assert.ok(acmeAudit.every((e) => e.org_id === acme.orgId));

  const globexAudit = await listAuditEvents(globex.orgId);
  assert.equal(globexAudit.length, 0);
  assert.equal(await countAuditEvents(globex.orgId), 0);
});
