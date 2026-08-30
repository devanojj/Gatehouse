import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";

import { execute, insert, queryOne } from "./db";
import { sendEmail } from "./email";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };

const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 30;

export type Session = {
  agentId: number;
  orgId: number;
  agentName: string;
  agentEmail: string;
  role: "owner" | "member";
  orgName: string;
};

function token(): string {
  return randomBytes(32).toString("hex");
}

/** SQLite stores timestamps as `datetime('now')` strings — UTC, no timezone. */
function sqlTimestamp(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().replace("T", " ").slice(0, 19);
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---------------------------------------------------------------- magic links

/**
 * Issues a magic link for an agent and emails it. Without RESEND_API_KEY the
 * full verify URL lands in the server console, which is how local dev logins
 * work with no email provider set up.
 */
export async function sendMagicLink(
  agentId: number,
  email: string,
  { isInvite = false }: { isInvite?: boolean } = {},
): Promise<void> {
  const linkToken = token();

  await insert(
    `INSERT INTO magic_links (agent_id, token, expires_at) VALUES (?, ?, ?)`,
    [agentId, linkToken, sqlTimestamp(MAGIC_LINK_MINUTES * 60 * 1000)],
  );

  const url = `${appUrl()}/login/verify?token=${linkToken}`;

  const subject = isInvite
    ? "You've been invited to Gatehouse"
    : "Your Gatehouse sign-in link";

  const body = isInvite
    ? [
        "A teammate has added you to their Gatehouse workspace.",
        "",
        "Open this link to sign in — no password required:",
        url,
        "",
        `The link expires in ${MAGIC_LINK_MINUTES} minutes.`,
      ].join("\n")
    : [
        "Here is your sign-in link for Gatehouse:",
        "",
        url,
        "",
        `It expires in ${MAGIC_LINK_MINUTES} minutes and can only be used once.`,
        "If you didn't request it, you can ignore this email.",
      ].join("\n");

  await sendEmail(email, subject, body);
}

export type MagicLinkRow = { id: number; agent_id: number };

/** Looks up an unused, unexpired magic link without consuming it. */
export async function findUsableMagicLink(
  linkToken: string,
): Promise<MagicLinkRow | null> {
  return queryOne<MagicLinkRow>(
    `SELECT id, agent_id
       FROM magic_links
      WHERE token = ?
        AND used_at IS NULL
        AND expires_at > datetime('now')`,
    [linkToken],
  );
}

// ------------------------------------------------------------------- sessions

/**
 * Consumes a magic link and starts a session. Returns false if the link was
 * already used, expired, or never existed.
 */
export async function startSessionFromMagicLink(
  linkToken: string,
): Promise<boolean> {
  const link = await findUsableMagicLink(linkToken);
  if (!link) return false;

  // Mark used first, and only if it is still unused, so two concurrent
  // submissions of the same link cannot both open a session.
  const claimed = await queryOne<{ id: number }>(
    `UPDATE magic_links
        SET used_at = datetime('now')
      WHERE id = ? AND used_at IS NULL
      RETURNING id`,
    [link.id],
  );
  if (!claimed) return false;

  const sessionToken = token();
  const expiresAt = sqlTimestamp(SESSION_DAYS * 24 * 60 * 60 * 1000);

  await insert(
    `INSERT INTO sessions (agent_id, token, expires_at) VALUES (?, ?, ?)`,
    [link.agent_id, sessionToken, expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });

  return true;
}

export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    await execute(`DELETE FROM sessions WHERE token = ?`, [sessionToken]);
  }
  cookieStore.delete(SESSION_COOKIE);
}

type SessionRow = {
  agent_id: number;
  org_id: number;
  agent_name: string;
  agent_email: string;
  role: string;
  org_name: string;
};

/**
 * Resolves the session cookie to an agent and their org.
 *
 * This is the *only* place an org_id enters the system. Every read and write
 * downstream takes its org_id from here — never from a form field, query
 * string, or route param.
 *
 * Memoized per render pass with React `cache`, so a page and its layout share
 * one database round trip.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;

  const row = await queryOne<SessionRow>(
    `SELECT s.agent_id     AS agent_id,
            a.org_id       AS org_id,
            a.name         AS agent_name,
            a.email        AS agent_email,
            a.role         AS role,
            o.name         AS org_name
       FROM sessions s
       JOIN agents a        ON a.id = s.agent_id
       JOIN organizations o ON o.id = a.org_id
      WHERE s.token = ?
        AND s.expires_at > datetime('now')`,
    [sessionToken],
  );

  if (!row) return null;

  return {
    agentId: Number(row.agent_id),
    orgId: Number(row.org_id),
    agentName: row.agent_name,
    agentEmail: row.agent_email,
    role: row.role === "owner" ? "owner" : "member",
    orgName: row.org_name,
  };
});

/** For pages, layouts, and every server action behind the login wall. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** For owner-only surfaces, e.g. team management. */
export async function requireOwner(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/tickets");
  return session;
}
