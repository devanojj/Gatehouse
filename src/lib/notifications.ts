import "server-only";

import { executeCounting, insert, query, queryOne } from "./db";

export type NotificationType =
  | "ticket_assigned"
  | "customer_reply"
  | "sla_warning"
  | "sla_breached";

export type Notification = {
  id: number;
  org_id: number;
  agent_id: number;
  ticket_id: number | null;
  type: NotificationType;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

/**
 * Creates an in-app notification for an agent, scoped to the organization.
 */
export async function createNotification(
  orgId: number,
  data: {
    agentId: number;
    ticketId?: number | null;
    type: NotificationType;
    title: string;
    body: string;
  },
): Promise<number> {
  return insert(
    `INSERT INTO notifications (org_id, agent_id, ticket_id, type, title, body, created_at)
     SELECT ?, a.id, ?, ?, ?, ?, datetime('now')
       FROM agents a
      WHERE a.id = ? AND a.org_id = ?`,
    [
      orgId,
      data.ticketId ?? null,
      data.type,
      data.title.trim(),
      data.body.trim(),
      data.agentId,
      orgId,
    ],
  );
}

/**
 * Lists notifications for an agent, ordered newest first.
 */
export async function listNotifications(
  orgId: number,
  agentId: number,
  {
    unreadOnly = false,
    limit = 50,
  }: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const unreadClause = unreadOnly ? "AND read_at IS NULL" : "";

  return query<Notification>(
    `SELECT * FROM notifications
      WHERE org_id = ? AND agent_id = ? ${unreadClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [orgId, agentId, limit],
  );
}

/**
 * Returns the number of unread notifications for an agent.
 */
export async function countUnreadNotifications(
  orgId: number,
  agentId: number,
): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM notifications
      WHERE org_id = ? AND agent_id = ? AND read_at IS NULL`,
    [orgId, agentId],
  );

  return Number(row?.count ?? 0);
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationRead(
  orgId: number,
  agentId: number,
  id: number,
): Promise<boolean> {
  const affected = await executeCounting(
    `UPDATE notifications
        SET read_at = datetime('now')
      WHERE org_id = ? AND agent_id = ? AND id = ? AND read_at IS NULL`,
    [orgId, agentId, id],
  );

  return affected > 0;
}

/**
 * Marks all unread notifications as read for an agent.
 */
export async function markAllNotificationsRead(
  orgId: number,
  agentId: number,
): Promise<number> {
  return executeCounting(
    `UPDATE notifications
        SET read_at = datetime('now')
      WHERE org_id = ? AND agent_id = ? AND read_at IS NULL`,
    [orgId, agentId],
  );
}
