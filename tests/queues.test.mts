import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner, createMember } = await import("../src/lib/agents");
const { listEvents } = await import("../src/lib/events");
const {
  createQueue,
  deleteQueue,
  getDefaultQueue,
  listQueues,
  setDefaultQueue,
} = await import("../src/lib/queues");
const { claimTicket, createTicket, getTicket, updateQueue } = await import(
  "../src/lib/tickets"
);

const acme = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

async function newTicket(orgId: number, queueId?: number): Promise<number> {
  return createTicket(orgId, {
    subject: "Printer offline",
    description: null,
    priority: "medium",
    requesterEmail: null,
    queueId,
  });
}

test("a new workspace gets a default queue", async () => {
  const queue = await getDefaultQueue(acme.orgId);
  assert.equal(queue?.name, "General");
  assert.equal(queue?.slug, "general");
});

test("a ticket with no queue lands in the default", async () => {
  const fallback = await getDefaultQueue(acme.orgId);
  const id = await newTicket(acme.orgId);

  assert.equal((await getTicket(acme.orgId, id))?.queue_id, fallback?.id);
});

test("two orgs can both have a queue called Billing", async () => {
  const ours = await createQueue(acme.orgId, "Billing");
  const theirs = await createQueue(globex.orgId, "Billing");

  assert.notEqual(ours, theirs);
  assert.deepEqual(
    (await listQueues(acme.orgId)).map((queue) => queue.name).sort(),
    ["Billing", "General"],
  );
});

test("a repeated name inside one org gets its own slug", async () => {
  await createQueue(acme.orgId, "Tier 2");
  await createQueue(acme.orgId, "Tier 2");

  const slugs = (await listQueues(acme.orgId))
    .filter((queue) => queue.name === "Tier 2")
    .map((queue) => queue.slug);

  assert.deepEqual(slugs.sort(), ["tier-2", "tier-2-2"]);
});

test("a queue from another org cannot receive a ticket", async () => {
  const id = await newTicket(acme.orgId);
  const before = (await getTicket(acme.orgId, id))?.queue_id;

  const theirQueue = (await listQueues(globex.orgId))[0];
  const moved = await updateQueue(acme.orgId, id, theirQueue.id);

  assert.equal(moved, false, "the move should not have applied");
  assert.equal(
    (await getTicket(acme.orgId, id))?.queue_id,
    before,
    "the ticket should not have left its own org's queue",
  );
});

test("a ticket created with another org's queue falls back to the default", async () => {
  const theirQueue = (await listQueues(globex.orgId))[0];
  const fallback = await getDefaultQueue(acme.orgId);

  const id = await newTicket(acme.orgId, theirQueue.id);

  assert.equal((await getTicket(acme.orgId, id))?.queue_id, fallback?.id);
});

test("only one agent wins a race to claim a ticket", async () => {
  const second = await createMember(acme.orgId, "Marcus", "marcus@acme.test");
  const id = await newTicket(acme.orgId);

  const [first, other] = await Promise.all([
    claimTicket(acme.orgId, id, acme.agentId),
    claimTicket(acme.orgId, id, second),
  ]);

  assert.equal(
    [first, other].filter(Boolean).length,
    1,
    "exactly one claim should have applied",
  );

  const ticket = await getTicket(acme.orgId, id);
  assert.ok(ticket?.assigned_agent_id === acme.agentId || ticket?.assigned_agent_id === second);
});

test("claiming does not reach across orgs", async () => {
  const id = await newTicket(acme.orgId);

  assert.equal(await claimTicket(globex.orgId, id, globex.agentId), false);
  assert.equal((await getTicket(acme.orgId, id))?.assigned_agent_id, null);
});

test("deleting a queue moves its tickets to the default", async () => {
  const doomed = await createQueue(acme.orgId, "Temporary");
  const id = await newTicket(acme.orgId, doomed);
  const fallback = await getDefaultQueue(acme.orgId);

  const result = await deleteQueue(acme.orgId, doomed);

  assert.equal(result.deleted, true);
  assert.equal(result.movedTickets, 1);
  assert.equal((await getTicket(acme.orgId, id))?.queue_id, fallback?.id);
});

test("the default queue cannot be deleted", async () => {
  const fallback = await getDefaultQueue(acme.orgId);
  const result = await deleteQueue(acme.orgId, fallback!.id);

  assert.equal(result.deleted, false);
  assert.notEqual(await getDefaultQueue(acme.orgId), null);
});

test("a queue from another org cannot be deleted or made default", async () => {
  const theirQueue = (await listQueues(globex.orgId))[0];

  assert.equal((await deleteQueue(acme.orgId, theirQueue.id)).deleted, false);
  assert.equal(await setDefaultQueue(acme.orgId, theirQueue.id), false);

  assert.equal(
    (await getDefaultQueue(globex.orgId))?.id,
    theirQueue.id,
    "their default should be untouched",
  );
});

test("moving a ticket between queues leaves it in one queue", async () => {
  const billing = (await listQueues(acme.orgId)).find((q) => q.name === "Billing")!;
  const id = await newTicket(acme.orgId);

  assert.equal(await updateQueue(acme.orgId, id, billing.id), true);
  assert.equal((await getTicket(acme.orgId, id))?.queue_id, billing.id);

  // The move itself is recorded by the action, not the query — the ticket's own
  // history should still show only its creation here.
  const events = await listEvents(acme.orgId, id);
  assert.deepEqual(events.map((event) => event.kind), ["created"]);
});
