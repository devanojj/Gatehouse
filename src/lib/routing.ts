import "server-only";

import { execute, executeCounting, insert, query, queryOne } from "./db";
import { type Priority } from "./tickets";

export const ROUTING_FIELDS = ["subject", "body", "requester_email"] as const;
export type RoutingField = (typeof ROUTING_FIELDS)[number];

export const ROUTING_OPERATORS = [
  "contains",
  "equals",
  "starts_with",
  "ends_with",
] as const;
export type RoutingOperator = (typeof ROUTING_OPERATORS)[number];

export type RoutingRule = {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  position: number;
  is_active: number;
  match_field: RoutingField;
  match_operator: RoutingOperator;
  match_value: string;
  target_queue_id: number | null;
  target_queue_name: string | null;
  target_agent_id: number | null;
  target_agent_name: string | null;
  target_priority: Priority | null;
  created_at: string;
  updated_at: string;
};

export function isRoutingField(value: unknown): value is RoutingField {
  return ROUTING_FIELDS.includes(value as RoutingField);
}

export function isRoutingOperator(value: unknown): value is RoutingOperator {
  return ROUTING_OPERATORS.includes(value as RoutingOperator);
}

/**
 * Lists all routing rules for an organization, ordered by position.
 */
export async function listRoutingRules(orgId: number): Promise<RoutingRule[]> {
  return query<RoutingRule>(
    `SELECT r.*, q.name AS target_queue_name, a.name AS target_agent_name
       FROM routing_rules r
       LEFT JOIN queues q
         ON q.id = r.target_queue_id
        AND q.org_id = r.org_id
       LEFT JOIN agents a
         ON a.id = r.target_agent_id
        AND a.org_id = r.org_id
      WHERE r.org_id = ?
      ORDER BY r.position ASC, r.id ASC`,
    [orgId],
  );
}

/**
 * Scoped lookup for a single routing rule.
 */
export async function getRoutingRule(
  orgId: number,
  ruleId: number,
): Promise<RoutingRule | null> {
  return queryOne<RoutingRule>(
    `SELECT r.*, q.name AS target_queue_name, a.name AS target_agent_name
       FROM routing_rules r
       LEFT JOIN queues q
         ON q.id = r.target_queue_id
        AND q.org_id = r.org_id
       LEFT JOIN agents a
         ON a.id = r.target_agent_id
        AND a.org_id = r.org_id
      WHERE r.org_id = ? AND r.id = ?`,
    [orgId, ruleId],
  );
}

/**
 * Creates a new routing rule at the next available position.
 */
export async function createRoutingRule(
  orgId: number,
  fields: {
    name: string;
    description?: string | null;
    matchField: RoutingField;
    matchOperator: RoutingOperator;
    matchValue: string;
    targetQueueId?: number | null;
    targetAgentId?: number | null;
    targetPriority?: Priority | null;
  },
): Promise<number> {
  const maxPosRow = await queryOne<{ max_pos: number | null }>(
    `SELECT MAX(position) AS max_pos FROM routing_rules WHERE org_id = ?`,
    [orgId],
  );
  const position = (maxPosRow?.max_pos ?? -1) + 1;

  // Verify target queue belongs to org if specified
  const targetQueueId = fields.targetQueueId
    ? (
        await queryOne<{ id: number }>(
          `SELECT id FROM queues WHERE id = ? AND org_id = ?`,
          [fields.targetQueueId, orgId],
        )
      )?.id ?? null
    : null;

  // Verify target agent belongs to org if specified
  const targetAgentId = fields.targetAgentId
    ? (
        await queryOne<{ id: number }>(
          `SELECT id FROM agents WHERE id = ? AND org_id = ?`,
          [fields.targetAgentId, orgId],
        )
      )?.id ?? null
    : null;

  return insert(
    `INSERT INTO routing_rules
       (org_id, name, description, position, is_active,
        match_field, match_operator, match_value,
        target_queue_id, target_agent_id, target_priority)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      orgId,
      fields.name.trim(),
      fields.description?.trim() || null,
      position,
      fields.matchField,
      fields.matchOperator,
      fields.matchValue.trim(),
      targetQueueId,
      targetAgentId,
      fields.targetPriority ?? null,
    ],
  );
}

/**
 * Updates an existing routing rule.
 */
export async function updateRoutingRule(
  orgId: number,
  ruleId: number,
  fields: {
    name?: string;
    description?: string | null;
    isActive?: boolean;
    matchField?: RoutingField;
    matchOperator?: RoutingOperator;
    matchValue?: string;
    targetQueueId?: number | null;
    targetAgentId?: number | null;
    targetPriority?: Priority | null;
    position?: number;
  },
): Promise<boolean> {
  const existing = await getRoutingRule(orgId, ruleId);
  if (!existing) return false;

  const targetQueueId =
    fields.targetQueueId !== undefined
      ? fields.targetQueueId
        ? (
            await queryOne<{ id: number }>(
              `SELECT id FROM queues WHERE id = ? AND org_id = ?`,
              [fields.targetQueueId, orgId],
            )
          )?.id ?? null
        : null
      : existing.target_queue_id;

  const targetAgentId =
    fields.targetAgentId !== undefined
      ? fields.targetAgentId
        ? (
            await queryOne<{ id: number }>(
              `SELECT id FROM agents WHERE id = ? AND org_id = ?`,
              [fields.targetAgentId, orgId],
            )
          )?.id ?? null
        : null
      : existing.target_agent_id;

  const rows = await executeCounting(
    `UPDATE routing_rules
        SET name = ?,
            description = ?,
            is_active = ?,
            match_field = ?,
            match_operator = ?,
            match_value = ?,
            target_queue_id = ?,
            target_agent_id = ?,
            target_priority = ?,
            position = ?,
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    [
      fields.name?.trim() ?? existing.name,
      fields.description !== undefined ? fields.description?.trim() || null : existing.description,
      fields.isActive !== undefined ? (fields.isActive ? 1 : 0) : existing.is_active,
      fields.matchField ?? existing.match_field,
      fields.matchOperator ?? existing.match_operator,
      fields.matchValue?.trim() ?? existing.match_value,
      targetQueueId,
      targetAgentId,
      fields.targetPriority !== undefined ? fields.targetPriority : existing.target_priority,
      fields.position !== undefined ? fields.position : existing.position,
      ruleId,
      orgId,
    ],
  );

  return rows > 0;
}

/**
 * Deletes a routing rule and defragments positions.
 */
export async function deleteRoutingRule(
  orgId: number,
  ruleId: number,
): Promise<boolean> {
  const rows = await executeCounting(
    `DELETE FROM routing_rules WHERE id = ? AND org_id = ?`,
    [ruleId, orgId],
  );

  if (rows > 0) {
    const remaining = await listRoutingRules(orgId);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await execute(
          `UPDATE routing_rules SET position = ? WHERE id = ? AND org_id = ?`,
          [i, remaining[i].id, orgId],
        );
      }
    }
  }

  return rows > 0;
}

/**
 * Sets new order for routing rules.
 */
export async function reorderRoutingRules(
  orgId: number,
  orderedRuleIds: number[],
): Promise<void> {
  for (let pos = 0; pos < orderedRuleIds.length; pos++) {
    await execute(
      `UPDATE routing_rules SET position = ? WHERE id = ? AND org_id = ?`,
      [pos, orderedRuleIds[pos], orgId],
    );
  }
}

/**
 * Pure evaluation helper checking if candidate text matches the given operator and pattern.
 */
export function matchesCondition(
  candidate: string,
  operator: RoutingOperator,
  expected: string,
): boolean {
  const val = candidate.toLowerCase();
  const pattern = expected.toLowerCase().trim();
  if (!pattern) return false;

  switch (operator) {
    case "contains":
      return val.includes(pattern);
    case "equals":
      return val === pattern;
    case "starts_with":
      return val.startsWith(pattern);
    case "ends_with":
      return val.endsWith(pattern);
    default:
      return false;
  }
}

export type RoutingMatch = {
  matchedRule: RoutingRule | null;
  queueId?: number;
  assignedAgentId?: number;
  priority?: Priority;
};

/**
 * Evaluates active routing rules against a ticket in position order.
 * Returns the first matching rule and its proposed actions.
 */
export async function evaluateRoutingRules(
  orgId: number,
  ticket: {
    subject: string;
    description?: string | null;
    requesterEmail?: string | null;
  },
): Promise<RoutingMatch> {
  const activeRules = await query<RoutingRule>(
    `SELECT * FROM routing_rules
      WHERE org_id = ? AND is_active = 1
      ORDER BY position ASC, id ASC`,
    [orgId],
  );

  for (const rule of activeRules) {
    let textToTest = "";
    if (rule.match_field === "subject") {
      textToTest = ticket.subject;
    } else if (rule.match_field === "body") {
      textToTest = ticket.description ?? "";
    } else if (rule.match_field === "requester_email") {
      textToTest = ticket.requesterEmail ?? "";
    }

    if (matchesCondition(textToTest, rule.match_operator, rule.match_value)) {
      const match: RoutingMatch = { matchedRule: rule };
      if (rule.target_queue_id !== null) match.queueId = rule.target_queue_id;
      if (rule.target_agent_id !== null) match.assignedAgentId = rule.target_agent_id;
      if (rule.target_priority !== null) match.priority = rule.target_priority;
      return match;
    }
  }

  return { matchedRule: null };
}
