import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { createComment, listComments } = await import("../src/lib/comments");
const { findOrCreateCustomer, findCustomer, findDuplicateSubmission, recentTicketCount } =
  await import("../src/lib/customers");
const { findOrganizationByPortalSlug } = await import("../src/lib/orgs");
const { toPortalMessages, toPortalTicket } = await import("../src/lib/portal");
const {
  createTicket,
  getCustomerTicket,
  getTicketByPublicToken,
  listCustomerTickets,
  reopenIfResolved,
  updateStatus,
} = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

// The same person writes to both tenants — the case where a shared identity
// would quietly cross the boundary.
const priyaAtAcme = await findOrCreateCustomer(acme.orgId, "priya@client.test", "Priya");
const priyaAtGlobex = await findOrCreateCustomer(globex.orgId, "Priya@Client.test", "P. Raman");

async function customerTicket(
  orgId: number,
  customerId: number,
  subject: string,
  token?: string,
): Promise<number> {
  return createTicket(orgId, {
    subject,
    description: "Details of the problem.",
    priority: "medium",
    requesterEmail: "priya@client.test",
    requesterCustomerId: customerId,
    publicToken: token ?? null,
    publicTokenExpiresAt: token
      ? new Date(Date.now() + 3600_000).toISOString().replace("T", " ").slice(0, 19)
      : null,
    source: "portal",
  });
}

test("one address is two customers in two orgs", async () => {
  assert.notEqual(priyaAtAcme.id, priyaAtGlobex.id);
  assert.equal(priyaAtAcme.email, "priya@client.test");
  assert.equal(
    priyaAtGlobex.email,
    "priya@client.test",
    "the address should be normalized before it is stored",
  );
});

test("a customer lookup does not cross orgs", async () => {
  const stranger = await findCustomer(acme.orgId, "ben@globex.test");
  assert.equal(stranger, null);
});

test("a customer sees only their own tickets, in their own org", async () => {
  const mine = await customerTicket(acme.orgId, priyaAtAcme.id, "Card declined");
  await customerTicket(globex.orgId, priyaAtGlobex.id, "Different tenant entirely");

  const listed = await listCustomerTickets(acme.orgId, priyaAtAcme.id);
  assert.deepEqual(listed.map((ticket) => ticket.id), [mine]);

  // Their id in the other tenant must not reach this tenant's rows either.
  assert.deepEqual(await listCustomerTickets(acme.orgId, priyaAtGlobex.id), []);
  assert.equal(await getCustomerTicket(acme.orgId, priyaAtGlobex.id, mine), null);
});

test("a ticket raised by somebody else is not readable", async () => {
  const other = await findOrCreateCustomer(acme.orgId, "sam@client.test", "Sam");
  const theirs = await customerTicket(acme.orgId, other.id, "Not yours");

  assert.equal(await getCustomerTicket(acme.orgId, priyaAtAcme.id, theirs), null);
});

test("a customer from another org is not linked to a ticket", async () => {
  const id = await createTicket(acme.orgId, {
    subject: "Crossed wires",
    description: null,
    priority: "medium",
    requesterEmail: "priya@client.test",
    requesterCustomerId: priyaAtGlobex.id,
    source: "portal",
  });

  const ticket = await getCustomerTicket(acme.orgId, priyaAtGlobex.id, id);
  assert.equal(ticket, null, "the foreign customer id should have become NULL");
});

test("internal notes never reach the portal", async () => {
  const id = await customerTicket(acme.orgId, priyaAtAcme.id, "With notes");

  await createComment(acme.orgId, id, acme.agentId, "internal", "Refund approved by finance.");
  await createComment(acme.orgId, id, acme.agentId, "public", "We are looking into it.");
  await createComment(acme.orgId, id, null, "inbound", "Thanks!", {
    authorEmail: "priya@client.test",
  });

  const all = await listComments(acme.orgId, id);
  assert.equal(all.length, 3);

  const shown = toPortalMessages(all, "Acme");
  assert.equal(shown.length, 2);
  assert.ok(
    !shown.some((message) => message.body.includes("finance")),
    "an internal note must not appear in the portal payload",
  );
  assert.deepEqual(shown.map((message) => message.author), ["Acme", "You"]);
});

test("the portal view drops operational fields entirely", async () => {
  const id = await customerTicket(acme.orgId, priyaAtAcme.id, "Field check");
  const row = (await getCustomerTicket(acme.orgId, priyaAtAcme.id, id))!;

  // The agent row carries these; the customer's copy must not, whatever is
  // added to `tickets` later.
  assert.notEqual(row.queue_id, null);
  const shown = toPortalTicket(row) as Record<string, unknown>;

  for (const field of [
    "queue_id",
    "queue_name",
    "assigned_agent_id",
    "assigned_agent_name",
    "priority",
    "first_response_at",
    "public_token",
    "requester_email",
  ]) {
    assert.equal(field in shown, false, `${field} should not be in the portal view`);
  }
});

test("a confirmation token opens one ticket, in one org, until it expires", async () => {
  const token = "token-under-test";
  const id = await customerTicket(acme.orgId, priyaAtAcme.id, "Tokened", token);

  assert.equal((await getTicketByPublicToken(acme.orgId, token))?.id, id);
  assert.equal(
    await getTicketByPublicToken(globex.orgId, token),
    null,
    "another tenant must not open it",
  );

  const expired = await createTicket(acme.orgId, {
    subject: "Old link",
    description: null,
    priority: "medium",
    requesterEmail: "priya@client.test",
    requesterCustomerId: priyaAtAcme.id,
    publicToken: "stale-token",
    publicTokenExpiresAt: "2020-01-01 00:00:00",
    source: "portal",
  });

  assert.ok(expired > 0);
  assert.equal(await getTicketByPublicToken(acme.orgId, "stale-token"), null);
});

test("a reply reopens a resolved ticket but never a closed one", async () => {
  const id = await customerTicket(acme.orgId, priyaAtAcme.id, "Reopen me");

  await updateStatus(acme.orgId, id, "resolved");
  const resolved = (await getCustomerTicket(acme.orgId, priyaAtAcme.id, id))!;
  assert.equal(await reopenIfResolved(acme.orgId, resolved), true);
  assert.equal((await getCustomerTicket(acme.orgId, priyaAtAcme.id, id))?.status, "open");

  await updateStatus(acme.orgId, id, "closed");
  const closed = (await getCustomerTicket(acme.orgId, priyaAtAcme.id, id))!;
  assert.equal(await reopenIfResolved(acme.orgId, closed), false);
  assert.equal((await getCustomerTicket(acme.orgId, priyaAtAcme.id, id))?.status, "closed");
});

test("a repeated submission is recognized rather than duplicated", async () => {
  const subject = "Same thing twice";
  const id = await customerTicket(acme.orgId, priyaAtAcme.id, subject, "dupe-token");

  const found = await findDuplicateSubmission(
    acme.orgId,
    "PRIYA@client.test",
    subject,
    5,
  );
  assert.equal(found?.id, id);

  // The other tenant's identical subject is not this org's duplicate.
  assert.equal(
    await findDuplicateSubmission(globex.orgId, "priya@client.test", subject, 5),
    null,
  );
});

test("the rate-limit count is per organization", async () => {
  const mine = await recentTicketCount(acme.orgId, "priya@client.test", 60);
  const theirs = await recentTicketCount(globex.orgId, "priya@client.test", 60);

  assert.ok(mine > theirs, "one tenant's volume must not throttle another's");
});

test("a ticket raised by email is waiting in the portal when they sign in", async () => {
  const sam = await findOrCreateCustomer(acme.orgId, "sam@client.test", "Sam");

  // No customer id supplied — this is what inbound mail and the agent form do.
  const byEmail = await createTicket(acme.orgId, {
    subject: "Sent from my mail client",
    description: "Written to the support address, never through the portal.",
    priority: "medium",
    requesterEmail: "Sam@Client.test",
    source: "email",
  });

  const listed = await listCustomerTickets(acme.orgId, sam.id);
  assert.ok(
    listed.some((ticket) => ticket.id === byEmail),
    "an emailed ticket should belong to the same customer record",
  );
});

test("each org gets its own readable portal slug", async () => {
  const found = await findOrganizationByPortalSlug("acme");
  assert.equal(found?.id, acme.orgId);

  assert.equal(await findOrganizationByPortalSlug("nobody"), null);

  // Not the inbound slug: that one carries a random suffix on purpose.
  assert.notEqual(found?.portal_slug, found?.inbound_slug);
});
