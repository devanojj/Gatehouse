import "server-only";

import { executeCounting, insert, query, queryOne } from "./db";
import { slugifyText } from "./slug";
import { toFtsQuery } from "./tickets";

export type ArticleStatus = "draft" | "published";

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return value === "draft" || value === "published";
}

export type Article = {
  id: number;
  org_id: number;
  category_id: number | null;
  title: string;
  slug: string;
  body: string;
  status: ArticleStatus;
  author_agent_id: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArticleWithCategory = Article & {
  category_name: string | null;
  category_slug: string | null;
  author_name: string | null;
};

export type ArticleFilters = {
  categoryId?: number | null;
  categorySlug?: string;
  status?: ArticleStatus;
  publishedOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

/**
 * Ensures an article slug is unique within this organization.
 */
export async function availableArticleSlug(
  orgId: number,
  titleOrSlug: string,
  excludeId?: number,
): Promise<string> {
  const base = slugifyText(titleOrSlug);

  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await queryOne<{ id: number }>(
      `SELECT id FROM articles
        WHERE org_id = ? AND slug = ? ${excludeId ? "AND id != ?" : ""}`,
      excludeId ? [orgId, candidate, excludeId] : [orgId, candidate],
    );
    if (!taken) return candidate;
  }
}

/**
 * Returns articles matching the given filters, scoped to the tenant.
 */
export async function listArticles(
  orgId: number,
  filters: ArticleFilters = {},
): Promise<ArticleWithCategory[]> {
  const conditions: string[] = ["a.org_id = ?"];
  const params: unknown[] = [orgId];

  let joinFts = false;
  let ftsQuery: string | null = null;

  if (filters.search) {
    ftsQuery = toFtsQuery(filters.search);
    if (ftsQuery) {
      joinFts = true;
      conditions.push("fts.articles_fts MATCH ?");
      params.push(ftsQuery);
    }
  }

  if (filters.publishedOnly) {
    conditions.push("a.status = 'published'");
  } else if (filters.status) {
    conditions.push("a.status = ?");
    params.push(filters.status);
  }

  if (filters.categoryId !== undefined) {
    if (filters.categoryId === null) {
      conditions.push("a.category_id IS NULL");
    } else {
      conditions.push("a.category_id = ?");
      params.push(filters.categoryId);
    }
  }

  if (filters.categorySlug) {
    conditions.push("c.slug = ?");
    params.push(filters.categorySlug);
  }

  const where = conditions.join(" AND ");
  const orderBy = joinFts
    ? "bm25(articles_fts, 2.0, 1.0) ASC, a.updated_at DESC"
    : "a.updated_at DESC";

  let limitClause = "";
  if (filters.limit) {
    limitClause = " LIMIT ?";
    params.push(filters.limit);
    if (filters.offset) {
      limitClause += " OFFSET ?";
      params.push(filters.offset);
    }
  }

  const ftsJoinClause = joinFts
    ? "JOIN articles_fts fts ON fts.article_id = a.id AND fts.org_id = a.org_id"
    : "";

  return query<ArticleWithCategory>(
    `SELECT a.*,
            c.name AS category_name,
            c.slug AS category_slug,
            ag.name AS author_name
       FROM articles a
       ${ftsJoinClause}
       LEFT JOIN kb_categories c ON c.id = a.category_id AND c.org_id = a.org_id
       LEFT JOIN agents ag ON ag.id = a.author_agent_id AND ag.org_id = a.org_id
      WHERE ${where}
      ORDER BY ${orderBy}
      ${limitClause}`,
    params,
  );
}

/**
 * Retrieves a single article by ID, scoped to the tenant.
 */
export async function getArticle(
  orgId: number,
  id: number,
): Promise<ArticleWithCategory | null> {
  return queryOne<ArticleWithCategory>(
    `SELECT a.*,
            c.name AS category_name,
            c.slug AS category_slug,
            ag.name AS author_name
       FROM articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id AND c.org_id = a.org_id
       LEFT JOIN agents ag ON ag.id = a.author_agent_id AND ag.org_id = a.org_id
      WHERE a.org_id = ? AND a.id = ?`,
    [orgId, id],
  );
}

/**
 * Retrieves an article by slug, with optional published-only restriction.
 */
export async function getArticleBySlug(
  orgId: number,
  slug: string,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<ArticleWithCategory | null> {
  const statusClause = publishedOnly ? "AND a.status = 'published'" : "";

  return queryOne<ArticleWithCategory>(
    `SELECT a.*,
            c.name AS category_name,
            c.slug AS category_slug,
            ag.name AS author_name
       FROM articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id AND c.org_id = a.org_id
       LEFT JOIN agents ag ON ag.id = a.author_agent_id AND ag.org_id = a.org_id
      WHERE a.org_id = ? AND a.slug = ? ${statusClause}`,
    [orgId, slug],
  );
}

/**
 * Counts articles by status for an organization.
 */
export async function countArticles(
  orgId: number,
): Promise<{ total: number; published: number; draft: number }> {
  const rows = await query<{ status: ArticleStatus; n: number }>(
    `SELECT status, COUNT(*) AS n
       FROM articles
      WHERE org_id = ?
      GROUP BY status`,
    [orgId],
  );

  let published = 0;
  let draft = 0;
  for (const row of rows) {
    if (row.status === "published") published = Number(row.n);
    if (row.status === "draft") draft = Number(row.n);
  }

  return {
    total: published + draft,
    published,
    draft,
  };
}

/**
 * Creates a new article in the organization.
 */
export async function createArticle(
  orgId: number,
  fields: {
    title: string;
    slug?: string;
    body: string;
    status?: ArticleStatus;
    categoryId?: number | null;
    authorAgentId?: number | null;
  },
): Promise<number> {
  const title = fields.title.trim();
  const slug = await availableArticleSlug(orgId, fields.slug?.trim() || title);
  const body = fields.body.trim();
  const status: ArticleStatus = fields.status === "published" ? "published" : "draft";
  const publishedAt = status === "published" ? new Date().toISOString() : null;

  // Ensure category belongs to this organization
  let validCategoryId: number | null = null;
  if (fields.categoryId) {
    const cat = await queryOne<{ id: number }>(
      `SELECT id FROM kb_categories WHERE org_id = ? AND id = ?`,
      [orgId, fields.categoryId],
    );
    if (cat) validCategoryId = cat.id;
  }

  // Ensure author belongs to this organization
  let validAuthorId: number | null = null;
  if (fields.authorAgentId) {
    const agent = await queryOne<{ id: number }>(
      `SELECT id FROM agents WHERE org_id = ? AND id = ?`,
      [orgId, fields.authorAgentId],
    );
    if (agent) validAuthorId = agent.id;
  }

  return insert(
    `INSERT INTO articles (
       org_id, category_id, title, slug, body, status,
       author_agent_id, published_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      orgId,
      validCategoryId,
      title,
      slug,
      body,
      status,
      validAuthorId,
      publishedAt,
    ],
  );
}

/**
 * Updates an article, verifying tenant ownership.
 */
export async function updateArticle(
  orgId: number,
  id: number,
  fields: {
    title?: string;
    slug?: string;
    body?: string;
    status?: ArticleStatus;
    categoryId?: number | null;
  },
): Promise<boolean> {
  const existing = await getArticle(orgId, id);
  if (!existing) return false;

  const title = fields.title !== undefined ? fields.title.trim() : existing.title;
  let slug = existing.slug;
  if (fields.slug !== undefined || (fields.title !== undefined && !fields.slug)) {
    const raw = fields.slug !== undefined ? fields.slug : title;
    slug = await availableArticleSlug(orgId, raw, id);
  }
  const body = fields.body !== undefined ? fields.body.trim() : existing.body;
  const status = fields.status !== undefined ? fields.status : existing.status;

  let publishedAt = existing.published_at;
  if (status === "published" && !existing.published_at) {
    publishedAt = new Date().toISOString();
  }

  let categoryId = existing.category_id;
  if (fields.categoryId !== undefined) {
    if (fields.categoryId === null) {
      categoryId = null;
    } else {
      const cat = await queryOne<{ id: number }>(
        `SELECT id FROM kb_categories WHERE org_id = ? AND id = ?`,
        [orgId, fields.categoryId],
      );
      categoryId = cat ? cat.id : null;
    }
  }

  const affected = await executeCounting(
    `UPDATE articles
        SET title = ?,
            slug = ?,
            body = ?,
            status = ?,
            category_id = ?,
            published_at = ?,
            updated_at = datetime('now')
      WHERE org_id = ? AND id = ?`,
    [title, slug, body, status, categoryId, publishedAt, orgId, id],
  );

  return affected > 0;
}

/**
 * Deletes an article from the organization.
 */
export async function deleteArticle(
  orgId: number,
  id: number,
): Promise<boolean> {
  const affected = await executeCounting(
    `DELETE FROM articles WHERE org_id = ? AND id = ?`,
    [orgId, id],
  );
  return affected > 0;
}
