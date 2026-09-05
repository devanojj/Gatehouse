import "server-only";

import { execute, insert, query, queryOne } from "./db";
import type { Priority } from "./tickets";

export type SlaPolicy = {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  is_default: number;
  created_at: string;
};

export type SlaTarget = {
  id: number;
  org_id: number;
  policy_id: number;
  priority: Priority;
  first_response_hours: number;
  resolution_hours: number;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_SLA_TARGETS: Record<
  Priority,
  { firstResponseHours: number; resolutionHours: number }
> = {
  high: { firstResponseHours: 1, resolutionHours: 8 },
  medium: { firstResponseHours: 4, resolutionHours: 24 },
  low: { firstResponseHours: 8, resolutionHours: 72 },
};

export type SlaStatus = "fulfilled" | "pending" | "breached" | "none";

export type TicketSlaEvaluation = {
  firstResponse: {
    status: SlaStatus;
    dueAt: string | null;
    fulfilledAt: string | null;
    breached: boolean;
  };
  resolution: {
    status: SlaStatus;
    dueAt: string | null;
    fulfilledAt: string | null;
    breached: boolean;
  };
  isBreached: boolean;
};

function toSqlDatetime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function parseSqlDate(s: string): Date {
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

/**
 * Gets or creates the default SLA policy for an organization.
 */
export async function getDefaultSlaPolicy(orgId: number): Promise<SlaPolicy> {
  const policy = await queryOne<SlaPolicy>(
    `SELECT * FROM sla_policies WHERE org_id = ? AND is_default = 1`,
    [orgId],
  );

  if (policy) return policy;

  const id = await insert(
    `INSERT INTO sla_policies (org_id, name, description, is_default)
     VALUES (?, 'Standard SLA', 'Default SLA policy for response and resolution targets.', 1)`,
    [orgId],
  );

  await execute(
    `INSERT OR IGNORE INTO sla_targets (org_id, policy_id, priority, first_response_hours, resolution_hours)
     VALUES (?, ?, 'high', 1, 8),
            (?, ?, 'medium', 4, 24),
            (?, ?, 'low', 8, 72)`,
    [orgId, id, orgId, id, orgId, id],
  );

  return (await queryOne<SlaPolicy>(
    `SELECT * FROM sla_policies WHERE org_id = ? AND id = ?`,
    [orgId, id],
  ))!;
}

/**
 * Lists SLA targets configured for an organization's default policy.
 */
export async function listSlaTargets(orgId: number): Promise<SlaTarget[]> {
  const policy = await getDefaultSlaPolicy(orgId);
  return query<SlaTarget>(
    `SELECT * FROM sla_targets WHERE org_id = ? AND policy_id = ? ORDER BY priority`,
    [orgId, policy.id],
  );
}

/**
 * Returns the effective target hours for each priority, merging database targets with defaults.
 */
export async function getEffectiveSlaTargets(
  orgId: number,
): Promise<Record<Priority, { firstResponseHours: number; resolutionHours: number }>> {
  const targets = await listSlaTargets(orgId);

  const result: Record<
    Priority,
    { firstResponseHours: number; resolutionHours: number }
  > = {
    high: { ...DEFAULT_SLA_TARGETS.high },
    medium: { ...DEFAULT_SLA_TARGETS.medium },
    low: { ...DEFAULT_SLA_TARGETS.low },
  };

  for (const t of targets) {
    if (t.priority in result) {
      result[t.priority] = {
        firstResponseHours: t.first_response_hours,
        resolutionHours: t.resolution_hours,
      };
    }
  }

  return result;
}

/**
 * Calculates deadline timestamps for a ticket based on the organization's policy and priority.
 */
export async function calculateSlaDeadlines(
  orgId: number,
  priority: Priority,
  baseDate: Date = new Date(),
): Promise<{
  policyId: number;
  firstResponseDueAt: string;
  resolutionDueAt: string;
}> {
  const policy = await getDefaultSlaPolicy(orgId);
  const targets = await getEffectiveSlaTargets(orgId);
  const target = targets[priority] ?? DEFAULT_SLA_TARGETS[priority];

  const firstResponseDue = new Date(
    baseDate.getTime() + target.firstResponseHours * 3600 * 1000,
  );
  const resolutionDue = new Date(
    baseDate.getTime() + target.resolutionHours * 3600 * 1000,
  );

  return {
    policyId: policy.id,
    firstResponseDueAt: toSqlDatetime(firstResponseDue),
    resolutionDueAt: toSqlDatetime(resolutionDue),
  };
}

/**
 * Updates SLA targets for an organization's default policy.
 */
export async function updateSlaTargets(
  orgId: number,
  targets: {
    priority: Priority;
    firstResponseHours: number;
    resolutionHours: number;
  }[],
): Promise<void> {
  const policy = await getDefaultSlaPolicy(orgId);

  for (const t of targets) {
    const firstHours = Math.max(1, Math.min(720, Math.round(t.firstResponseHours)));
    const resHours = Math.max(1, Math.min(2160, Math.round(t.resolutionHours)));

    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM sla_targets WHERE org_id = ? AND policy_id = ? AND priority = ?`,
      [orgId, policy.id, t.priority],
    );

    if (existing) {
      await execute(
        `UPDATE sla_targets
            SET first_response_hours = ?,
                resolution_hours = ?,
                updated_at = datetime('now')
          WHERE id = ? AND org_id = ?`,
        [firstHours, resHours, existing.id, orgId],
      );
    } else {
      await execute(
        `INSERT INTO sla_targets (org_id, policy_id, priority, first_response_hours, resolution_hours)
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, policy.id, t.priority, firstHours, resHours],
      );
    }
  }
}

/**
 * Evaluates the SLA performance and current status of a ticket.
 */
export function evaluateTicketSla(ticket: {
  status: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_first_response_due_at: string | null;
  sla_resolution_due_at: string | null;
  sla_first_response_breached?: number;
  sla_resolution_breached?: number;
  sla_breached?: number;
}): TicketSlaEvaluation {
  const now = new Date();

  // First response evaluation
  let frStatus: SlaStatus = "none";
  let frBreached = Boolean(ticket.sla_first_response_breached);

  if (ticket.sla_first_response_due_at) {
    const frDue = parseSqlDate(ticket.sla_first_response_due_at);
    if (ticket.first_response_at) {
      const frDone = parseSqlDate(ticket.first_response_at);
      if (frDone.getTime() > frDue.getTime() || frBreached) {
        frStatus = "breached";
        frBreached = true;
      } else {
        frStatus = "fulfilled";
      }
    } else {
      if (now.getTime() > frDue.getTime() || frBreached) {
        frStatus = "breached";
        frBreached = true;
      } else {
        frStatus = "pending";
      }
    }
  }

  // Resolution evaluation
  let resStatus: SlaStatus = "none";
  let resBreached = Boolean(ticket.sla_resolution_breached);

  if (ticket.sla_resolution_due_at) {
    const resDue = parseSqlDate(ticket.sla_resolution_due_at);
    if (ticket.status === "resolved" || ticket.status === "closed") {
      if (ticket.resolved_at) {
        const resDone = parseSqlDate(ticket.resolved_at);
        if (resDone.getTime() > resDue.getTime() || resBreached) {
          resStatus = "breached";
          resBreached = true;
        } else {
          resStatus = "fulfilled";
        }
      } else {
        resStatus = "fulfilled";
      }
    } else {
      if (now.getTime() > resDue.getTime() || resBreached) {
        resStatus = "breached";
        resBreached = true;
      } else {
        resStatus = "pending";
      }
    }
  }

  return {
    firstResponse: {
      status: frStatus,
      dueAt: ticket.sla_first_response_due_at,
      fulfilledAt: ticket.first_response_at,
      breached: frBreached,
    },
    resolution: {
      status: resStatus,
      dueAt: ticket.sla_resolution_due_at,
      fulfilledAt: ticket.resolved_at,
      breached: resBreached,
    },
    isBreached: frBreached || resBreached || Boolean(ticket.sla_breached),
  };
}
