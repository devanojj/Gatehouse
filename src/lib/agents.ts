import "server-only";

import { insert, queryOne, query, SLUG_ATTEMPTS } from "./db";
import { newInboundSlug } from "./slug";

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

/**
 * One agent inside an organization. Server Actions call this to turn an id from
 * a form into a real teammate before using it, so a foreign id is "not found"
 * rather than a silent no-op.
 */
export async function getAgent(
  orgId: number,
  agentId: number,
): Promise<Agent | null> {
  return queryOne<Agent>(`SELECT * FROM agents WHERE org_id = ? AND id = ?`, [
    orgId,
    agentId,
  ]);
}

export async function listAgents(orgId: number): Promise<Agent[]> {
  return query<Agent>(
    `SELECT * FROM agents WHERE org_id = ? ORDER BY name COLLATE NOCASE`,
    [orgId],
  );
}

/**
 * The inbound slug is generated here, server-side, and never accepted from the
 * signup form — it is the routing key for a tenant's mail, so a caller must not
 * be able to choose one that collides with (or impersonates) another org.
 */
async function insertOrganization(
  orgName: string,
  supportEmail: string | null,
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert(
        `INSERT INTO organizations (name, support_email, inbound_slug)
         VALUES (?, ?, ?)`,
        [orgName, supportEmail, newInboundSlug(orgName)],
      );
    } catch (error) {
      // Only a slug collision is worth re-rolling; anything else is a real
      // failure and should surface.
      if (attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}

export async function createOrganizationWithOwner(
  orgName: string,
  agentName: string,
  email: string,
  supportEmail: string | null = null,
): Promise<{ orgId: number; agentId: number }> {
  const orgId = await insertOrganization(orgName, supportEmail);

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
