import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const {
  canTransition,
  createTicket,
  findOpenTicketByRequester,
  getTicket,
  markFirstResponse,
  updateStatus,
} = await import("../src/lib/tickets");

const org = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");

async function newTicket(requesterEmail: string | null = null): Promise<number> {
  return createTicket(org.orgId, {
    subject: "Printer offline",
    description: null,
    priority: "medium",
    requesterEmail,
    actorAgentId: org.agentId,
  });
}

test("resolving stamps resolved_at", async () => {
  const id = await newTicket();
  assert.equal((await getTicket(org.orgId, id))?.resolved_at, null);

  await updateStatus(org.orgId, id, "resolved");
  assert.notEqual((await getTicket(org.orgId, id))?.resolved_at, null);
});

test("closing a resolved ticket keeps the original resolution time", async () => {
  const id = await newTicket();

  await updateStatus(org.orgId, id, "resolved");
  const resolvedAt = (await getTicket(org.orgId, id))?.resolved_at;

  await updateStatus(org.orgId, id, "closed");
  assert.equal((await getTicket(org.orgId, id))?.resolved_at, resolvedAt);
});

test("reopening clears resolved_at", async () => {
  const id = await newTicket();

  await updateStatus(org.orgId, id, "resolved");
  await updateStatus(org.orgId, id, "open");

  assert.equal(
    (await getTicket(org.orgId, id))?.resolved_at,
    null,
    "a reopened ticket must not still count as resolved",
  );
});

test("first response is recorded once and never overwritten", async () => {
  const id = await newTicket();

  assert.equal(await markFirstResponse(org.orgId, id), true);
  const first = (await getTicket(org.orgId, id))?.first_response_at;
  assert.notEqual(first, null);

  assert.equal(
    await markFirstResponse(org.orgId, id),
    false,
    "a second reply must not move the first-response time",
  );
  assert.equal((await getTicket(org.orgId, id))?.first_response_at, first);
});

test("a reply can join any status except closed", async () => {
  const requester = "priya@client.test";
  const id = await newTicket(requester);

  // `resolved` is included: a reply to something marked resolved is the case
  // where the fix did not work, and it reopens the ticket.
  for (const status of [
    "open",
    "in_progress",
    "pending_customer",
    "resolved",
  ] as const) {
    await updateStatus(org.orgId, id, status);
    const found = await findOpenTicketByRequester(org.orgId, requester);
    assert.equal(found?.id, id, `${status} should still receive replies`);
  }

  await updateStatus(org.orgId, id, "closed");
  assert.equal(
    await findOpenTicketByRequester(org.orgId, requester),
    null,
    "a closed ticket should not be revived by a new message",
  );
});

test("transitions allow every active move and lock closed down", async () => {
  assert.equal(canTransition("open", "resolved"), true);
  assert.equal(canTransition("resolved", "open"), true);
  assert.equal(canTransition("pending_customer", "in_progress"), true);

  assert.equal(canTransition("closed", "open"), true, "reopening is the way out");
  for (const status of ["in_progress", "pending_customer", "resolved"] as const) {
    assert.equal(
      canTransition("closed", status),
      false,
      `closed should not move straight to ${status}`,
    );
  }
});
