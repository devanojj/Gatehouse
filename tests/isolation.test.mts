import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { createComment, listComments } = await import("../src/lib/comments");
const { listEvents, recordEvent } = await import("../src/lib/events");
const {
  countTicketsByStatus,
  createTicket,
  findOpenTicketByRequester,
  getTicket,
  listTickets,
  updateAssignee,
  updateStatus,
} = await import("../src/lib/tickets");

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
