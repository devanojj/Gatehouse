import "server-only";

import { execute, queryOne } from "./db";
import { plusAddress } from "./slug";

export type Organization = {
  id: number;
  name: string;
  support_email: string | null;
  inbound_slug: string | null;
  created_at: string;
};

export async function getOrganization(
  orgId: number,
): Promise<Organization | null> {
  return queryOne<Organization>(`SELECT * FROM organizations WHERE id = ?`, [
    orgId,
  ]);
}

/**
 * Resolves an inbound slug to the organization that owns it.
 *
 * This is the one place a tenant is chosen by something other than the session
 * cookie, so the lookup is exact — no prefix or case-insensitive matching that
 * could land a message in the wrong workspace.
 */
export async function findOrganizationBySlug(
  slug: string,
): Promise<Organization | null> {
  return queryOne<Organization>(
    `SELECT * FROM organizations WHERE inbound_slug = ?`,
    [slug],
  );
}

export async function setSupportEmail(
  orgId: number,
  supportEmail: string | null,
): Promise<void> {
  await execute(`UPDATE organizations SET support_email = ? WHERE id = ?`, [
    supportEmail,
    orgId,
  ]);
}

// ----------------------------------------------------------- inbox addresses

/**
 * The shared mailbox every organization's mail arrives at. One Gmail account
 * serves every tenant; the `+slug` on the address is what separates them.
 */
export function sharedInboxAddress(): string | null {
  const address = process.env.GMAIL_USER?.trim();
  return address ? address : null;
}

/** The address an organization publishes (or forwards) to. */
export function inboundAddressFor(org: {
  inbound_slug: string | null;
}): string | null {
  const inbox = sharedInboxAddress();
  if (!inbox || !org.inbound_slug) return null;
  return plusAddress(inbox, org.inbound_slug);
}

/**
 * Whether the server can actually reach the shared inbox. The settings page
 * uses this to explain what is missing rather than failing at the button.
 */
export function inboundCredentials(): { user: string; password: string } | null {
  const user = sharedInboxAddress();
  const password = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!user || !password) return null;
  return { user, password };
}
