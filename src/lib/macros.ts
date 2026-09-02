import "server-only";

import { execute, insert, query, queryOne } from "./db";

export const MACRO_NAME_MAX = 80;
export const MACRO_BODY_MAX = 8000;

export type Macro = {
  id: number;
  org_id: number;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export async function listMacros(orgId: number): Promise<Macro[]> {
  return query<Macro>(
    `SELECT * FROM macros WHERE org_id = ? ORDER BY name COLLATE NOCASE`,
    [orgId],
  );
}

export async function getMacro(
  orgId: number,
  macroId: number,
): Promise<Macro | null> {
  return queryOne<Macro>(`SELECT * FROM macros WHERE org_id = ? AND id = ?`, [
    orgId,
    macroId,
  ]);
}

export async function createMacro(
  orgId: number,
  name: string,
  body: string,
): Promise<number> {
  return insert(`INSERT INTO macros (org_id, name, body) VALUES (?, ?, ?)`, [
    orgId,
    name,
    body,
  ]);
}

export async function updateMacro(
  orgId: number,
  macroId: number,
  name: string,
  body: string,
): Promise<void> {
  await execute(
    `UPDATE macros
        SET name = ?, body = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [name, body, macroId, orgId],
  );
}

export async function deleteMacro(
  orgId: number,
  macroId: number,
): Promise<void> {
  await execute(`DELETE FROM macros WHERE id = ? AND org_id = ?`, [
    macroId,
    orgId,
  ]);
}

// ------------------------------------------------------------ interpolation

/** What a macro may refer to. Everything here is already inside one org. */
export type MacroContext = {
  ticketNumber: number;
  ticketSubject: string;
  requesterEmail: string | null;
  agentName: string;
  orgName: string;
};

/**
 * The placeholders a macro can use, in the order they are shown to the author.
 * Anything else in double braces is left exactly as written — an unknown name
 * is a typo, and silently deleting the surrounding sentence would be worse than
 * leaving the placeholder visible in the draft.
 */
export const MACRO_PLACEHOLDERS = [
  "requester_name",
  "requester_email",
  "ticket_number",
  "ticket_subject",
  "agent_name",
  "org_name",
] as const;

const PLACEHOLDER = /\{\{\s*([a-z_]{1,40})\s*\}\}/gi;

export function applyMacro(body: string, context: MacroContext): string {
  const values: Record<string, string> = {
    requester_name: requesterName(context.requesterEmail),
    // A ticket raised by an agent may have no requester address at all; a
    // neutral word keeps the sentence readable instead of leaving a gap.
    requester_email: context.requesterEmail ?? "the requester",
    ticket_number: `#${context.ticketNumber}`,
    ticket_subject: context.ticketSubject,
    agent_name: context.agentName,
    org_name: context.orgName,
  };

  return body.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name.toLowerCase()];
    return value === undefined ? whole : value;
  });
}

/**
 * A usable first name from an address — `dana.okafor@acme.com` becomes "Dana".
 * There is no name column on a ticket, and guessing beyond the local part would
 * put the wrong word in front of a customer.
 */
function requesterName(email: string | null): string {
  const localPart = email?.split("@")[0]?.trim();
  if (!localPart) return "there";

  const first = localPart.split(/[._+-]+/).find((part) => /^[a-z]/i.test(part));
  if (!first) return "there";

  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
