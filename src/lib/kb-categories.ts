import "server-only";

import { executeCounting, insert, query, queryOne } from "./db";
import { slugifyText } from "./slug";

export type KbCategory = {
  id: number;
  org_id: number;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  created_at: string;
};

export type KbCategoryWithCount = KbCategory & {
  article_count: number;
};

/**
 * Returns all categories for an organization, ordered by position and name.
 */
export async function listCategories(orgId: number): Promise<KbCategory[]> {
  return query<KbCategory>(
    `SELECT * FROM kb_categories
      WHERE org_id = ?
      ORDER BY position ASC, name COLLATE NOCASE ASC`,
    [orgId],
  );
}

/**
 * Returns categories with the count of articles in each.
 * When `publishedOnly` is true, only published articles are counted.
 */
export async function listCategoriesWithCounts(
  orgId: number,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<KbCategoryWithCount[]> {
  const statusClause = publishedOnly ? "AND a.status = 'published'" : "";

  return query<KbCategoryWithCount>(
    `SELECT c.*,
            (SELECT COUNT(*)
               FROM articles a
              WHERE a.org_id = c.org_id
                AND a.category_id = c.id
                ${statusClause}) AS article_count
       FROM kb_categories c
      WHERE c.org_id = ?
      ORDER BY c.position ASC, c.name COLLATE NOCASE ASC`,
    [orgId],
  );
}

export async function getCategory(
  orgId: number,
  id: number,
): Promise<KbCategory | null> {
  return queryOne<KbCategory>(
    `SELECT * FROM kb_categories WHERE org_id = ? AND id = ?`,
    [orgId, id],
  );
}

export async function getCategoryBySlug(
  orgId: number,
  slug: string,
): Promise<KbCategory | null> {
  return queryOne<KbCategory>(
    `SELECT * FROM kb_categories WHERE org_id = ? AND slug = ?`,
    [orgId, slug],
  );
}

/**
 * Ensures a slug is unique within this organization.
 */
async function availableCategorySlug(
  orgId: number,
  nameOrSlug: string,
  excludeId?: number,
): Promise<string> {
  const base = slugifyText(nameOrSlug);

  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await queryOne<{ id: number }>(
      `SELECT id FROM kb_categories
        WHERE org_id = ? AND slug = ? ${excludeId ? "AND id != ?" : ""}`,
      excludeId ? [orgId, candidate, excludeId] : [orgId, candidate],
    );
    if (!taken) return candidate;
  }
}

export async function createCategory(
  orgId: number,
  fields: {
    name: string;
    slug?: string;
    description?: string | null;
    position?: number;
  },
): Promise<number> {
  const name = fields.name.trim();
  const slug = await availableCategorySlug(orgId, fields.slug?.trim() || name);
  const description = fields.description?.trim() || null;
  const position = Number.isInteger(fields.position) ? Number(fields.position) : 0;

  return insert(
    `INSERT INTO kb_categories (org_id, name, slug, description, position)
     VALUES (?, ?, ?, ?, ?)`,
    [orgId, name, slug, description, position],
  );
}

export async function updateCategory(
  orgId: number,
  id: number,
  fields: {
    name?: string;
    slug?: string;
    description?: string | null;
    position?: number;
  },
): Promise<boolean> {
  const existing = await getCategory(orgId, id);
  if (!existing) return false;

  const name = fields.name !== undefined ? fields.name.trim() : existing.name;
  let slug = existing.slug;
  if (fields.slug !== undefined || (fields.name !== undefined && !fields.slug)) {
    const raw = fields.slug !== undefined ? fields.slug : name;
    slug = await availableCategorySlug(orgId, raw, id);
  }
  const description =
    fields.description !== undefined
      ? fields.description?.trim() || null
      : existing.description;
  const position =
    fields.position !== undefined ? Number(fields.position) : existing.position;

  const affected = await executeCounting(
    `UPDATE kb_categories
        SET name = ?, slug = ?, description = ?, position = ?
      WHERE org_id = ? AND id = ?`,
    [name, slug, description, position, orgId, id],
  );

  return affected > 0;
}

export async function deleteCategory(
  orgId: number,
  id: number,
): Promise<boolean> {
  const affected = await executeCounting(
    `DELETE FROM kb_categories WHERE org_id = ? AND id = ?`,
    [orgId, id],
  );
  return affected > 0;
}
