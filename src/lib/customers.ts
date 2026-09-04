import "server-only";

import { execute, insert, query, queryOne } from "./db";

/**
 * A customer is scoped to one organization, not to Gatehouse.
 *
 * The same person writing to two tenants is two rows: they may be known by
 * different names, and one tenant learning that the other has a customer by
 * that address would itself be a leak. `agents.email` is globally unique for
 * the opposite reason — an agent belongs to exactly one org.
 */
export type Customer = {
  id: number;
  org_id: number;
  email: string;
  name: string | null;
  verified_at: string | null;
  created_at: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findCustomer(
  orgId: number,
  email: string,
): Promise<Customer | null> {
  return queryOne<Customer>(
    `SELECT * FROM customers WHERE org_id = ? AND email = ?`,
    [orgId, normalizeEmail(email)],
  );
}

export async function getCustomer(
  orgId: number,
  customerId: number,
): Promise<Customer | null> {
  return queryOne<Customer>(
    `SELECT * FROM customers WHERE org_id = ? AND id = ?`,
    [orgId, customerId],
  );
}

/**
 * Finds the customer for an address, creating one if this org has not seen it.
 *
 * Submitting a form does not verify anybody: the row is created unverified, and
 * `verified_at` is only set by following a link sent to that address. Until
 * then the address can raise tickets but cannot read them back.
 */
export async function findOrCreateCustomer(
  orgId: number,
  email: string,
  name: string | null,
): Promise<Customer> {
  const address = normalizeEmail(email);
  const existing = await findCustomer(orgId, address);

  if (existing) {
    // A returning customer who gives a name when we had none keeps it.
    if (!existing.name && name) {
      await execute(`UPDATE customers SET name = ? WHERE id = ? AND org_id = ?`, [
        name,
        existing.id,
        orgId,
      ]);
      return { ...existing, name };
    }
    return existing;
  }

  const id = await insert(
    `INSERT INTO customers (org_id, email, name) VALUES (?, ?, ?)`,
    [orgId, address, name],
  );

  return {
    id,
    org_id: orgId,
    email: address,
    name,
    verified_at: null,
    created_at: new Date().toISOString(),
  };
}

export async function markCustomerVerified(
  orgId: number,
  customerId: number,
): Promise<void> {
  await execute(
    `UPDATE customers SET verified_at = COALESCE(verified_at, datetime('now'))
      WHERE id = ? AND org_id = ?`,
    [customerId, orgId],
  );
}

/**
 * How many tickets this address has raised here recently.
 *
 * Used to stop a stuck form — or a script — from filling a tenant's queue. It
 * counts rather than throttling by time window alone, so a customer with a
 * genuine burst of problems still gets through the first several.
 */
export async function recentTicketCount(
  orgId: number,
  email: string,
  withinMinutes: number,
): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tickets
      WHERE org_id = ?
        AND requester_email = ?
        AND created_at > datetime('now', ?)`,
    [orgId, normalizeEmail(email), `-${withinMinutes} minutes`],
  );

  return Number(rows[0]?.n ?? 0);
}

/**
 * The same subject from the same address, moments ago.
 *
 * A double-submitted form should not become two tickets, and the customer
 * should land on the one that already exists rather than being told off.
 */
export async function findDuplicateSubmission(
  orgId: number,
  email: string,
  subject: string,
  withinMinutes: number,
): Promise<{ id: number; public_token: string | null } | null> {
  return queryOne<{ id: number; public_token: string | null }>(
    `SELECT id, public_token FROM tickets
      WHERE org_id = ?
        AND requester_email = ?
        AND subject = ?
        AND created_at > datetime('now', ?)
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, normalizeEmail(email), subject, `-${withinMinutes} minutes`],
  );
}
