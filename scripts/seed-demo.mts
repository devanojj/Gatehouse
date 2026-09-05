/**
 * Fills ./scratch.db with a workspace you can click around in.
 * Safe by construction: it refuses to run against anything but a file: database.
 */
const url = process.env.TURSO_DATABASE_URL ?? "file:./scratch.db";
if (!url.startsWith("file:")) {
  throw new Error(`Refusing to seed a non-file database: ${url}`);
}
process.env.TURSO_DATABASE_URL = url;
delete process.env.TURSO_AUTH_TOKEN;

const root = "../src/lib";

const { createOrganizationWithOwner, createMember } = await import(`${root}/agents`);
const { createQueue } = await import(`${root}/queues`);
const { createTicket, updateStatus, updateAssignee, updateQueue } = await import(`${root}/tickets`);
const { createComment } = await import(`${root}/comments`);
const { createCategory } = await import(`${root}/kb-categories`);
const { createArticle } = await import(`${root}/articles`);
const { insert } = await import(`${root}/db`);

// --- two tenants, so you can check isolation by hand -------------------------
const acme = await createOrganizationWithOwner("Acme Support", "Ava Stone", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex Helpdesk", "Ben Ortiz", "ben@globex.test");

const marcus = await createMember(acme.orgId, "Marcus Hale", "marcus@acme.test");

const billing = await createQueue(acme.orgId, "Billing");
const tech = await createQueue(acme.orgId, "Technical Support");

// --- tickets in a spread of states -------------------------------------------
const t1 = await createTicket(acme.orgId, {
  subject: "VPN drops every ten minutes",
  description: "Reconnects on its own but drops again after about ten minutes.",
  priority: "high",
  requesterEmail: "priya@client.test",
  actorAgentId: acme.agentId,
  source: "agent",
});
await updateQueue(acme.orgId, t1, tech);
await updateAssignee(acme.orgId, t1, marcus);
await createComment(acme.orgId, t1, acme.agentId, "internal", "Escalate to the network team if it recurs.", { authorEmail: "ava@acme.test" });
await createComment(acme.orgId, t1, acme.agentId, "public", "Thanks Priya - which VPN client version are you on?", { authorEmail: "ava@acme.test" });
await updateStatus(acme.orgId, t1, "pending_customer");

const t2 = await createTicket(acme.orgId, {
  subject: "Invoice 4102 charged twice",
  description: "We were billed for the same invoice on the 2nd and the 4th.",
  priority: "high",
  requesterEmail: "dan@client.test",
  source: "portal",
});
await updateQueue(acme.orgId, t2, billing);

const t3 = await createTicket(acme.orgId, {
  subject: "Password reset link expired",
  description: "The reset link had run out by the time I opened it.",
  priority: "low",
  requesterEmail: "sam@client.test",
  source: "email",
});
await updateStatus(acme.orgId, t3, "resolved");

for (let i = 1; i <= 6; i++) {
  await createTicket(acme.orgId, {
    subject: `Laptop will not join the wifi (${i})`,
    description: "Sits on 'obtaining IP address' and never connects.",
    priority: i % 2 ? "medium" : "low",
    requesterEmail: `user${i}@client.test`,
    source: "email",
  });
}

// Another tenant's data, to prove it never shows up on Acme's side.
await createTicket(globex.orgId, {
  subject: "GLOBEX ONLY - should never appear in Acme",
  description: "If you can see this from Acme, isolation is broken.",
  priority: "high",
  requesterEmail: "priya@client.test",
  source: "portal",
});

// --- knowledge base ----------------------------------------------------------
const gettingStarted = await createCategory(acme.orgId, { name: "Getting started" });
const billingCat = await createCategory(acme.orgId, { name: "Billing" });

await createArticle(acme.orgId, {
  title: "Resetting your password",
  body: "Open the sign-in page and choose **Forgot password**. The link we email you lasts 30 minutes.\n\nIf it has expired, request another - old links stop working as soon as a new one is sent.",
  status: "published",
  categoryId: gettingStarted,
  authorAgentId: acme.agentId,
});
await createArticle(acme.orgId, {
  title: "Understanding your invoice",
  body: "Invoices are issued on the first working day of each month.\n\nEach line shows the seat count on the day of billing, so a seat added mid-month appears on the following invoice.",
  status: "published",
  categoryId: billingCat,
  authorAgentId: acme.agentId,
});
await createArticle(acme.orgId, {
  title: "DRAFT - refund policy rewrite",
  body: "This one is a draft. It must never appear in the customer portal.",
  status: "draft",
  categoryId: billingCat,
  authorAgentId: acme.agentId,
});

// --- a sign-in link you can paste straight into the browser ------------------
// Written directly rather than through `sendMagicLink`, which reaches into
// next/navigation and cannot load outside the framework. Same table, longer life.
const { randomBytes } = await import("node:crypto");
const linkToken = randomBytes(32).toString("hex");
await insert(
  `INSERT INTO magic_links (agent_id, token, expires_at)
   VALUES (?, ?, datetime('now', '+7 days'))`,
  [acme.agentId, linkToken],
);

console.log("\nSeeded ./scratch.db");
console.log(`  Acme portal:   /o/acme-support`);
console.log(`  Globex portal: /o/globex-helpdesk`);
console.log(`  Agent login:   ava@acme.test  (owner)   marcus@acme.test (member)`);
console.log(`  Other tenant:  ben@globex.test`);
console.log("\nSign in as Ava (valid 7 days):");
console.log(`  http://localhost:3000/login/verify?token=${linkToken}\n`);
