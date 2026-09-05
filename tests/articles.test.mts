import assert from "node:assert/strict";
import test from "node:test";

import { scratchDatabase } from "./helpers/harness.mjs";

scratchDatabase();

const { createOrganizationWithOwner } = await import("../src/lib/agents");
const {
  countArticles,
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
  listCategoriesWithCounts,
  updateCategory,
} = await import("../src/lib/kb-categories");
const { toPortalArticle, toPortalCategory } = await import("../src/lib/portal");

const acme = await createOrganizationWithOwner("Acme", "Ava", "ava@acme.test");
const globex = await createOrganizationWithOwner("Globex", "Ben", "ben@globex.test");

test("categories can be created and duplicate names get distinct slugs within an org", async () => {
  const cat1Id = await createCategory(acme.orgId, {
    name: "Getting Started",
    description: "Introductory guides",
    position: 1,
  });

  const cat2Id = await createCategory(acme.orgId, {
    name: "Getting Started",
    description: "Duplicate name gets numbered slug",
    position: 2,
  });

  const cat1 = await getCategory(acme.orgId, cat1Id);
  const cat2 = await getCategory(acme.orgId, cat2Id);

  assert.equal(cat1?.name, "Getting Started");
  assert.equal(cat1?.slug, "getting-started");
  assert.equal(cat2?.slug, "getting-started-2");
});

test("two different orgs can use the exact same category slug", async () => {
  const globexCatId = await createCategory(globex.orgId, {
    name: "Getting Started",
  });
  const globexCat = await getCategory(globex.orgId, globexCatId);
  assert.equal(globexCat?.slug, "getting-started");
});

test("category lookup by slug, listing, update, and portal projection", async () => {
  const cat = await getCategoryBySlug(acme.orgId, "getting-started");
  assert.equal(cat?.name, "Getting Started");

  const list = await listCategories(acme.orgId);
  assert.ok(list.length >= 2);

  await updateCategory(acme.orgId, cat!.id, { name: "Quick Start" });
  const updated = await getCategory(acme.orgId, cat!.id);
  assert.equal(updated?.name, "Quick Start");

  const portalCat = toPortalCategory(updated!);
  assert.equal(portalCat.name, "Quick Start");
  assert.equal("org_id" in portalCat, false);
});


test("articles can be drafted and published with correct lifecycle timestamps", async () => {
  const draftId = await createArticle(acme.orgId, {
    title: "Draft Guide",
    body: "This is a secret work-in-progress draft.",
    status: "draft",
    authorAgentId: acme.agentId,
  });

  const draft = await getArticle(acme.orgId, draftId);
  assert.equal(draft?.status, "draft");
  assert.equal(draft?.published_at, null);

  const publishedId = await createArticle(acme.orgId, {
    title: "Public FAQ",
    body: "Answers to frequently asked questions.",
    status: "published",
    authorAgentId: acme.agentId,
  });

  const published = await getArticle(acme.orgId, publishedId);
  assert.equal(published?.status, "published");
  assert.notEqual(published?.published_at, null);

  // Promoting draft to published sets published_at
  await updateArticle(acme.orgId, draftId, { status: "published" });
  const promoted = await getArticle(acme.orgId, draftId);
  assert.equal(promoted?.status, "published");
  assert.notEqual(promoted?.published_at, null);
});

test("draft articles never appear on the customer portal", async () => {
  const secretId = await createArticle(acme.orgId, {
    title: "Internal Runbook",
    slug: "internal-runbook",
    body: "Only for agent eyes.",
    status: "draft",
  });

  const rawDraft = (await getArticle(acme.orgId, secretId))!;
  assert.equal(toPortalArticle(rawDraft), null, "toPortalArticle must reject drafts");

  const portalLookup = await getArticleBySlug(acme.orgId, "internal-runbook", {
    publishedOnly: true,
  });
  assert.equal(portalLookup, null, "getArticleBySlug with publishedOnly must exclude drafts");

  const publicList = await listArticles(acme.orgId, { publishedOnly: true });
  assert.equal(
    publicList.some((a) => a.id === secretId),
    false,
    "listArticles with publishedOnly must not contain draft articles",
  );
});

test("toPortalArticle strips agent internal fields", async () => {
  const pubId = await createArticle(acme.orgId, {
    title: "How to Pay",
    slug: "how-to-pay",
    body: "Go to your account settings to pay.",
    status: "published",
    authorAgentId: acme.agentId,
  });

  const raw = (await getArticle(acme.orgId, pubId))!;
  const projected = toPortalArticle(raw);

  assert.ok(projected);
  assert.equal(projected.title, "How to Pay");
  assert.equal(projected.slug, "how-to-pay");
  assert.equal(projected.body, "Go to your account settings to pay.");
  assert.equal("author_agent_id" in projected, false);
  assert.equal("org_id" in projected, false);
});

test("FTS5 full-text search indexes article title and body with prefix and punctuation safety", async () => {
  await createArticle(acme.orgId, {
    title: "Configuring Single Sign-On (SAML)",
    body: "Here is how to configure Okta and Azure AD SSO with your organization identity provider.",
    status: "published",
  });

  await createArticle(acme.orgId, {
    title: "Billing and Invoices",
    body: "Download PDF receipts and manage your subscription credit card.",
    status: "published",
  });

  // Search by keyword in title
  const ssoResults = await listArticles(acme.orgId, { search: "Sign-On" });
  assert.equal(ssoResults.length, 1);
  assert.equal(ssoResults[0].title, "Configuring Single Sign-On (SAML)");

  // Search by keyword in body
  const oktaResults = await listArticles(acme.orgId, { search: "Okta" });
  assert.equal(oktaResults.length, 1);
  assert.equal(oktaResults[0].title, "Configuring Single Sign-On (SAML)");

  // Prefix search
  const prefixResults = await listArticles(acme.orgId, { search: "subscrip" });
  assert.equal(prefixResults.length, 1);
  assert.equal(prefixResults[0].title, "Billing and Invoices");

  // Punctuation and malformed input safety
  const safePunctuation = await listArticles(acme.orgId, { search: '""***(()) OR NOT AND' });
  assert.ok(Array.isArray(safePunctuation));
});

test("FTS5 triggers update index when article title/body changes and clean up on delete", async () => {
  const artId = await createArticle(acme.orgId, {
    title: "Legacy Authentication",
    body: "Deprecated username and password method.",
    status: "published",
  });

  const found1 = await listArticles(acme.orgId, { search: "Deprecated" });
  assert.equal(found1.some((a) => a.id === artId), true);

  // Update body
  await updateArticle(acme.orgId, artId, {
    title: "Legacy Authentication",
    body: "Modernized biometric passkey authentication method.",
  });

  const foundOld = await listArticles(acme.orgId, { search: "Deprecated" });
  assert.equal(foundOld.some((a) => a.id === artId), false);

  const foundNew = await listArticles(acme.orgId, { search: "passkey" });
  assert.equal(foundNew.some((a) => a.id === artId), true);

  // Delete article
  await deleteArticle(acme.orgId, artId);
  const foundAfterDelete = await listArticles(acme.orgId, { search: "passkey" });
  assert.equal(foundAfterDelete.some((a) => a.id === artId), false);
});

test("deleting a category sets articles.category_id to NULL without deleting the articles", async () => {
  const catId = await createCategory(acme.orgId, { name: "Troubleshooting" });
  const artId = await createArticle(acme.orgId, {
    title: "Network connectivity issue",
    body: "Check firewall and router settings.",
    categoryId: catId,
    status: "published",
  });

  let art = await getArticle(acme.orgId, artId);
  assert.equal(art?.category_id, catId);
  assert.equal(art?.category_name, "Troubleshooting");

  await deleteCategory(acme.orgId, catId);

  art = await getArticle(acme.orgId, artId);
  assert.ok(art, "article should not have been deleted");
  assert.equal(art.category_id, null);
  assert.equal(art.category_name, null);
});

test("category counts accurately reflect published vs draft articles", async () => {
  const catId = await createCategory(acme.orgId, { name: "Security" });
  await createArticle(acme.orgId, {
    title: "Published Security Article",
    body: "Public tips.",
    categoryId: catId,
    status: "published",
  });
  await createArticle(acme.orgId, {
    title: "Draft Security Article",
    body: "Private internal tips.",
    categoryId: catId,
    status: "draft",
  });

  const allCounts = await listCategoriesWithCounts(acme.orgId);
  const secCatAll = allCounts.find((c) => c.id === catId);
  assert.equal(secCatAll?.article_count, 2);

  const pubCounts = await listCategoriesWithCounts(acme.orgId, { publishedOnly: true });
  const secCatPub = pubCounts.find((c) => c.id === catId);
  assert.equal(secCatPub?.article_count, 1);
});

test("countArticles returns total, published, and draft counts", async () => {
  const counts = await countArticles(acme.orgId);
  assert.equal(counts.total, counts.published + counts.draft);
  assert.ok(counts.published > 0);
});
