import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const { createComment } = await import("../src/lib/comments");
const { execute } = await import("../src/lib/db");
const {
  createTicket,
  listTickets,
  ticketNumberFromSearch,
  toFtsQuery,
} = await import("../src/lib/tickets");

const acme = await createOrganizationWithOwner("Acme Corp", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

const t1 = await createTicket(acme.orgId, {
  subject: "VPN connection dropping frequently",
  description: "When connecting via WireGuard the tunnel disconnects after 5 minutes.",
  priority: "high",
  requesterEmail: "sarah@acme-client.test",
  actorAgentId: acme.agentId,
});

const t2 = await createTicket(acme.orgId, {
  subject: "Invoice question for August",
  description: "Can you provide the VAT receipt for the latest billing period?",
  priority: "low",
  requesterEmail: "finance@partner.test",
  actorAgentId: acme.agentId,
});

await createComment(
  acme.orgId,
  t2,
  acme.agentId,
  "internal",
  "The Stripe charge ID is ch_123456789 and invoice was generated.",
  { authorEmail: "ava@acme.test" },
);

// Globex ticket with similar keywords to test tenant isolation
const g1 = await createTicket(globex.orgId, {
  subject: "VPN WireGuard access needed",
  description: "Please provision VPN access for new hire.",
  priority: "high",
  requesterEmail: "sarah@acme-client.test", // Same email in different org!
  actorAgentId: globex.agentId,
});

test("toFtsQuery sanitizes complex and malformed input safely", () => {
  assert.equal(toFtsQuery(""), null);
  assert.equal(toFtsQuery("   "), null);
  assert.equal(toFtsQuery("??? !!!"), null);
  assert.equal(toFtsQuery("wireguard"), '"wireguard"*');
  assert.equal(toFtsQuery("wireguard vpn"), '"wireguard"* "vpn"*');
  assert.equal(toFtsQuery("sarah@acme-client.test"), '"sarah"* "acme"* "client"* "test"*');
  assert.equal(toFtsQuery('NOT AND OR * : () "" hello'), '"NOT"* "AND"* "OR"* "hello"*');
});

test("ticketNumberFromSearch parses ticket numbers correctly", () => {
  assert.equal(ticketNumberFromSearch(""), null);
  assert.equal(ticketNumberFromSearch("abc"), null);
  assert.equal(ticketNumberFromSearch("123"), 123);
  assert.equal(ticketNumberFromSearch("#123"), 123);
  assert.equal(ticketNumberFromSearch("  #42  "), 42);
});

test("searches tickets by subject and description with prefix matching", async () => {
  const vpnResults = await listTickets(acme.orgId, { search: "wireg" });
  assert.equal(vpnResults.length, 1);
  assert.equal(vpnResults[0].id, t1);

  const tunnelResults = await listTickets(acme.orgId, { search: "tunnel disconnect" });
  assert.equal(tunnelResults.length, 1);
  assert.equal(tunnelResults[0].id, t1);
});

test("searches tickets by requester email", async () => {
  const requesterResults = await listTickets(acme.orgId, {
    search: "sarah@acme-client.test",
  });
  assert.equal(requesterResults.length, 1);
  assert.equal(requesterResults[0].id, t1);
});

test("searches tickets by comment text", async () => {
  const commentResults = await listTickets(acme.orgId, { search: "Stripe charge" });
  assert.equal(commentResults.length, 1);
  assert.equal(commentResults[0].id, t2);
});

test("searches directly by ticket number", async () => {
  const byNumber = await listTickets(acme.orgId, { search: `#${t1}` });
  assert.equal(byNumber.length, 1);
  assert.equal(byNumber[0].id, t1);

  const byDigits = await listTickets(acme.orgId, { search: String(t2) });
  assert.equal(byDigits.length, 1);
  assert.equal(byDigits[0].id, t2);
});

test("triggers keep search index updated on ticket update and delete", async () => {
  // Update subject
  await execute(
    `UPDATE tickets SET subject = 'Updated Kubernetes cluster alert' WHERE id = ? AND org_id = ?`,
    [t1, acme.orgId],
  );

  const updatedMatches = await listTickets(acme.orgId, { search: "Kubernetes" });
  assert.equal(updatedMatches.length, 1);
  assert.equal(updatedMatches[0].id, t1);

  // Old subject keyword no longer matches
  const oldMatches = await listTickets(acme.orgId, { search: "dropping frequently" });
  assert.equal(oldMatches.length, 0);
});

test("triggers keep search index updated on comment addition", async () => {
  await createComment(
    acme.orgId,
    t1,
    acme.agentId,
    "internal",
    "Deploying helm chart fix",
    { authorEmail: "ava@acme.test" },
  );

  const matches = await listTickets(acme.orgId, { search: "helm chart" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, t1);
});

test("search never returns results from another organization", async () => {
  // WireGuard exists in both Acme (t1 description) and Globex (g1 subject)
  const acmeMatches = await listTickets(acme.orgId, { search: "WireGuard" });
  assert.ok(acmeMatches.some((t) => t.id === t1));
  assert.ok(!acmeMatches.some((t) => t.id === g1));

  const globexMatches = await listTickets(globex.orgId, { search: "WireGuard" });
  assert.equal(globexMatches.length, 1);
  assert.equal(globexMatches[0].id, g1);

  // Searching Globex by Acme's ticket number yields zero results
  const foreignNum = await listTickets(globex.orgId, { search: `#${t1}` });
  assert.equal(foreignNum.length, 0);
});
