import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const {
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

test("inbound threading follows active statuses only", async () => {
  const requester = "priya@client.test";
  const id = await newTicket(requester);

  for (const status of ["open", "in_progress", "pending_customer"] as const) {
    await updateStatus(org.orgId, id, status);
    const found = await findOpenTicketByRequester(org.orgId, requester);
    assert.equal(found?.id, id, `${status} should still receive replies`);
  }

  for (const status of ["resolved", "closed"] as const) {
    await updateStatus(org.orgId, id, status);
    assert.equal(
      await findOpenTicketByRequester(org.orgId, requester),
      null,
      `${status} should not silently swallow a new request`,
    );
  }
});
