import "server-only";

import { insert, query } from "./db";

export const COMMENT_TYPES = ["public", "internal"] as const;
export type CommentType = (typeof COMMENT_TYPES)[number];

export function isCommentType(value: unknown): value is CommentType {
  return COMMENT_TYPES.includes(value as CommentType);
}

export type Comment = {
  id: number;
  org_id: number;
  ticket_id: number;
  agent_id: number | null;
  agent_name: string | null;
  type: CommentType;
  body: string;
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
  agentId: number,
  type: CommentType,
  body: string,
): Promise<number> {
  return insert(
    `INSERT INTO comments (org_id, ticket_id, agent_id, type, body)
     VALUES (?, ?, ?, ?, ?)`,
    [orgId, ticketId, agentId, type, body],
  );
}
