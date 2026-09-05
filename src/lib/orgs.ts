import "server-only";

import { execute, queryOne } from "./db";
import { plusAddress, slugifyOrgName } from "./slug";

export type Organization = {
  id: number;
  name: string;
  support_email: string | null;
  inbound_slug: string | null;
  /** The readable slug in the customer portal's URL. */
  portal_slug: string | null;
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

/**
 * Resolves a portal URL to the organization whose portal it is.
 *
 * Like `findOrganizationBySlug`, the match is exact: no prefix or
 * case-insensitive matching that could land a visitor in the wrong tenant. This
 * decides which portal is being *viewed*; it never decides whose tickets may be
 * read — a customer session does that.
 */
export async function findOrganizationByPortalSlug(
  slug: string,
): Promise<Organization | null> {
  return queryOne<Organization>(
    `SELECT * FROM organizations WHERE portal_slug = ?`,
    [slug],
  );
}

/**
 * A free, readable slug for a new organization's portal.
 *
 * The backfill in migration 005 does the same thing for organizations that
 * existed before the portal did; this is the path every new one takes. The
 * unique index is the real arbiter — a caller that loses a race re-rolls.
 */
export async function availablePortalSlug(name: string): Promise<string> {
  const base = slugifyOrgName(name);

  for (let suffix = 1; ; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;

    const taken = await queryOne(
      `SELECT 1 FROM organizations WHERE portal_slug = ?`,
      [candidate],
    );

    if (!taken) return candidate;
  }
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
