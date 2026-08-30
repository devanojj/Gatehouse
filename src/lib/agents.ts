import "server-only";

import { insert, queryOne, query } from "./db";

export type Agent = {
  id: number;
  org_id: number;
  name: string;
  email: string;
  role: "owner" | "member";
  created_at: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Global lookup by email — used only by login and signup, which run before any
 * org context exists. Everything else must go through `listAgents(orgId)`.
 */
export async function findAgentByEmail(email: string): Promise<Agent | null> {
  return queryOne<Agent>(`SELECT * FROM agents WHERE email = ?`, [
    normalizeEmail(email),
  ]);
}

export async function listAgents(orgId: number): Promise<Agent[]> {
  return query<Agent>(
    `SELECT * FROM agents WHERE org_id = ? ORDER BY name COLLATE NOCASE`,
    [orgId],
  );
}

export async function createOrganizationWithOwner(
  orgName: string,
  agentName: string,
  email: string,
): Promise<{ orgId: number; agentId: number }> {
  const orgId = await insert(`INSERT INTO organizations (name) VALUES (?)`, [
    orgName,
  ]);

  const agentId = await insert(
    `INSERT INTO agents (org_id, name, email, role) VALUES (?, ?, ?, 'owner')`,
    [orgId, agentName, normalizeEmail(email)],
  );

  return { orgId, agentId };
}

export async function createMember(
  orgId: number,
  name: string,
  email: string,
): Promise<number> {
  return insert(
    `INSERT INTO agents (org_id, name, email, role) VALUES (?, ?, ?, 'member')`,
    [orgId, name, normalizeEmail(email)],
  );
}
