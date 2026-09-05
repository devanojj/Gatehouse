import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";

import { getCustomer, markCustomerVerified } from "./customers";
import { execute, insert, queryOne } from "./db";
import { sendEmail } from "./email";
import { CUSTOMER_SESSION_COOKIE } from "./session-cookie";

export { CUSTOMER_SESSION_COOKIE };

const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 30;

/**
 * A signed-in customer.
 *
 * `orgId` comes from the session row, never from the URL. The portal's org slug
 * decides which organization's *portal* is being viewed; this decides whose
 * tickets may be read. When they disagree, the session wins and the visitor is
 * treated as signed out for that portal.
 */
export type CustomerSession = {
  customerId: number;
  orgId: number;
  email: string;
  name: string | null;
};

function token(): string {
  return randomBytes(32).toString("hex");
}

function sqlTimestamp(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().replace("T", " ").slice(0, 19);
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---------------------------------------------------------------- magic links

/**
 * Emails a customer a link that proves they own the address.
 *
 * The link is per organization: it carries the portal slug, and the session it
 * opens is scoped to that org's customer row.
 */
export async function sendCustomerMagicLink(
  customerId: number,
  email: string,
  orgName: string,
  portalSlug: string,
): Promise<void> {
  const linkToken = token();

  await insert(
    `INSERT INTO customer_magic_links (customer_id, token, expires_at)
     VALUES (?, ?, ?)`,
    [customerId, linkToken, sqlTimestamp(MAGIC_LINK_MINUTES * 60 * 1000)],
  );

  const url = `${appUrl()}/o/${portalSlug}/support/login/verify?token=${linkToken}`;

  await sendEmail(
    email,
    // Not "Your <org> support link": plenty of organizations are already called
    // something Support, and the subject line reads twice.
    `Your sign-in link for ${orgName}`,
    [
      `Open this link to see your requests to ${orgName}:`,
      "",
      url,
      "",
      `It expires in ${MAGIC_LINK_MINUTES} minutes and can only be used once.`,
      "If you didn't ask for it, you can ignore this email.",
    ].join("\n"),
    { fromName: orgName },
  );
}

/** Whether a link is still openable, for rendering the page before it is used. */
export async function findUsableCustomerLink(
  linkToken: string,
): Promise<{ customer_id: number; org_id: number } | null> {
  return queryOne<{ customer_id: number; org_id: number }>(
    `SELECT l.customer_id, c.org_id
       FROM customer_magic_links l
       JOIN customers c ON c.id = l.customer_id
      WHERE l.token = ?
        AND l.used_at IS NULL
        AND l.expires_at > datetime('now')`,
    [linkToken],
  );
}

// ------------------------------------------------------------------- sessions

/**
 * Consumes a customer link and opens a session, verifying the address as a
 * side effect — following the link is the proof.
 *
 * Returns the organization the session belongs to, so the caller can check the
 * portal being visited is the same one.
 */
export async function startCustomerSessionFromMagicLink(
  linkToken: string,
): Promise<{ orgId: number } | null> {
  const link = await queryOne<{ id: number; customer_id: number; org_id: number }>(
    `SELECT l.id, l.customer_id, c.org_id
       FROM customer_magic_links l
       JOIN customers c ON c.id = l.customer_id
      WHERE l.token = ?
        AND l.used_at IS NULL
        AND l.expires_at > datetime('now')`,
    [linkToken],
  );
  if (!link) return null;

  // Claimed first, and only if still unused, so two submissions of the same
  // link cannot both open a session.
  const claimed = await queryOne<{ id: number }>(
    `UPDATE customer_magic_links
        SET used_at = datetime('now')
      WHERE id = ? AND used_at IS NULL
      RETURNING id`,
    [link.id],
  );
  if (!claimed) return null;

  const sessionToken = token();

  await insert(
    `INSERT INTO customer_sessions (customer_id, token, expires_at) VALUES (?, ?, ?)`,
    [link.customer_id, sessionToken, sqlTimestamp(SESSION_DAYS * 24 * 60 * 60 * 1000)],
  );

  await markCustomerVerified(Number(link.org_id), Number(link.customer_id));

  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });

  return { orgId: Number(link.org_id) };
}

export async function endCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;

  if (sessionToken) {
    await execute(`DELETE FROM customer_sessions WHERE token = ?`, [sessionToken]);
  }
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
}

type CustomerSessionRow = {
  customer_id: number;
  org_id: number;
  email: string;
  name: string | null;
};

/**
 * Resolves the customer cookie. The only place a customer's `orgId` and
 * `customerId` enter the system — never a URL, never a form field.
 */
export const getCustomerSession = cache(
  async (): Promise<CustomerSession | null> => {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
    if (!sessionToken) return null;

    const row = await queryOne<CustomerSessionRow>(
      `SELECT s.customer_id AS customer_id,
              c.org_id      AS org_id,
              c.email       AS email,
              c.name        AS name
         FROM customer_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.token = ?
          AND s.expires_at > datetime('now')
          AND c.verified_at IS NOT NULL`,
      [sessionToken],
    );

    if (!row) return null;

    return {
      customerId: Number(row.customer_id),
      orgId: Number(row.org_id),
      email: row.email,
      name: row.name,
    };
  },
);

/**
 * For portal pages behind the sign-in wall.
 *
 * A session for a different organization is not a session here: someone signed
 * in to one tenant's portal who opens another's is sent to that portal's sign-in
 * page, not shown anything.
 */
export async function requireCustomerSession(
  orgId: number,
  portalSlug: string,
): Promise<CustomerSession> {
  const session = await getCustomerSession();

  if (!session || session.orgId !== orgId) {
    redirect(`/o/${portalSlug}/support/login`);
  }

  // The row is re-read against the org rather than trusted from the join above.
  const customer = await getCustomer(orgId, session.customerId);
  if (!customer) redirect(`/o/${portalSlug}/support/login`);

  return session;
}
