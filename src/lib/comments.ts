import "server-only";

import { insert, query, queryOne } from "./db";

/**
 * What an agent can post from the composer. Deliberately narrower than
 * `CommentType`: `inbound` is written by the mail fetcher alone, so a crafted
 * form post cannot make an agent's words look like they came from the client.
 */
export const AGENT_COMMENT_TYPES = ["public", "internal"] as const;
export type AgentCommentType = (typeof AGENT_COMMENT_TYPES)[number];

/** Everything that can appear in a thread. */
export type CommentType = AgentCommentType | "inbound";

export function isAgentCommentType(value: unknown): value is AgentCommentType {
  return AGENT_COMMENT_TYPES.includes(value as AgentCommentType);
}

export type Comment = {
  id: number;
  org_id: number;
  ticket_id: number;
  agent_id: number | null;
  agent_name: string | null;
  type: CommentType;
  body: string;
  author_email: string | null;
  source_message_id: string | null;
  created_at: string;
};

/**
 * `comments.org_id` is filtered directly rather than reached through a join on
 * `tickets` — the duplicated column is the safety net if a query ever forgets
 * to constrain the ticket.
 */
export async function listComments(
  orgId: number,
  ticketId: number,
): Promise<Comment[]> {
  return query<Comment>(
    `SELECT c.*, a.name AS agent_name
       FROM comments c
       LEFT JOIN agents a
         ON a.id = c.agent_id
        AND a.org_id = c.org_id
      WHERE c.org_id = ? AND c.ticket_id = ?
      ORDER BY c.created_at, c.id`,
    [orgId, ticketId],
  );
}

export async function createComment(
  orgId: number,
  ticketId: number,
  agentId: number | null,
  type: CommentType,
  body: string,
  source: { authorEmail?: string | null; messageId?: string | null } = {},
): Promise<number> {
  return insert(
    `INSERT INTO comments
       (org_id, ticket_id, agent_id, type, body, author_email, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId,
      ticketId,
      agentId,
      type,
      body,
      source.authorEmail ?? null,
      source.messageId ?? null,
    ],
  );
}

/**
 * Whether an inbound message has already been filed in this org, as either a
 * ticket or a comment. The IMAP `\Seen` flag is shared mutable state that
 * anyone with the mailbox open can clear, so it is not trusted on its own.
 */
export async function messageAlreadyFiled(
  orgId: number,
  messageId: string,
): Promise<boolean> {
  const hit = await queryOne<{ found: number }>(
    `SELECT 1 AS found FROM comments WHERE org_id = ? AND source_message_id = ?
     UNION ALL
     SELECT 1 AS found FROM tickets  WHERE org_id = ? AND source_message_id = ?
     LIMIT 1`,
    [orgId, messageId, orgId, messageId],
  );
  return hit !== null;
}
