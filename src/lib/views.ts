import "server-only";

import { executeCounting, insert, query, queryOne } from "./db";

export type SavedView = {
  id: number;
  org_id: number;
  name: string;
  filters: string;
  created_by_agent_id: number | null;
  created_at: string;
};

/**
 * Lists all custom views saved for an organization, sorted alphabetically.
 */
export async function listSavedViews(orgId: number): Promise<SavedView[]> {
  return query<SavedView>(
    `SELECT * FROM saved_views WHERE org_id = ? ORDER BY name COLLATE NOCASE`,
    [orgId],
  );
}

/**
 * Fetches a single saved view, strictly verifying that it belongs to the tenant.
 */
export async function getSavedView(
  orgId: number,
  viewId: number,
): Promise<SavedView | null> {
  return queryOne<SavedView>(
    `SELECT * FROM saved_views WHERE org_id = ? AND id = ?`,
    [orgId, viewId],
  );
}

/**
 * Creates a new custom saved view for an organization.
 */
export async function createSavedView(
  orgId: number,
  agentId: number | null,
  name: string,
  filters: string,
): Promise<number> {
  return insert(
    `INSERT INTO saved_views (org_id, name, filters, created_by_agent_id)
     VALUES (?, ?, ?, (SELECT id FROM agents WHERE id = ? AND org_id = ?))`,
    [orgId, name.trim(), filters.trim(), agentId, orgId],
  );
}

/**
 * Deletes a saved view if it belongs to the organization.
 */
export async function deleteSavedView(
  orgId: number,
  viewId: number,
): Promise<boolean> {
  const affected = await executeCounting(
    `DELETE FROM saved_views WHERE org_id = ? AND id = ?`,
    [orgId, viewId],
  );
  return affected > 0;
}
