import "server-only";

import { execute, executeCounting, query } from "./db";
import { recordEvent } from "./events";
import { fetchInboundMail } from "./inbound";
import { createNotification } from "./notifications";
import { inboundCredentials, type Organization } from "./orgs";

export type SchedulerResult = {
  timestamp: string;
  sla: {
    firstResponseBreaches: number;
    resolutionBreaches: number;
    warningsIssued: number;
  };
  mail: {
    polled: boolean;
    orgsChecked: number;
    messagesCreated: number;
    messagesAppended: number;
  };
  autoClosed: number;
};

/**
 * Executes scheduled background tasks:
 * 1. Evaluates SLA due dates and flags newly breached tickets.
 * 2. Issues SLA warnings for tickets nearing breach.
 * 3. Collects inbound email across tenants if mail credentials exist.
 * 4. Auto-closes resolved tickets older than 7 days.
 */
export async function runScheduledTasks(
  options: { orgId?: number } = {},
): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    timestamp: new Date().toISOString(),
    sla: {
      firstResponseBreaches: 0,
      resolutionBreaches: 0,
      warningsIssued: 0,
    },
    mail: {
      polled: false,
      orgsChecked: 0,
      messagesCreated: 0,
      messagesAppended: 0,
    },
    autoClosed: 0,
  };

  const orgFilter = options.orgId ? "AND t.org_id = ?" : "";
  const orgParams = options.orgId ? [options.orgId] : [];

  // 1. SLA First Response Breaches
  const overdueResponseTickets = await query<{
    id: number;
    org_id: number;
    subject: string;
    assigned_agent_id: number | null;
  }>(
    `SELECT t.id, t.org_id, t.subject, t.assigned_agent_id
       FROM tickets t
      WHERE t.first_response_at IS NULL
        AND t.sla_first_response_due_at IS NOT NULL
        AND t.sla_first_response_due_at < datetime('now')
        AND t.sla_first_response_breached = 0
        AND t.status NOT IN ('resolved', 'closed')
        ${orgFilter}`,
    orgParams,
  );

  for (const ticket of overdueResponseTickets) {
    await execute(
      `UPDATE tickets
          SET sla_first_response_breached = 1,
              sla_breached = 1
        WHERE id = ? AND org_id = ?`,
      [ticket.id, ticket.org_id],
    );

    await recordEvent(ticket.org_id, ticket.id, "sla_breached", {
      from: null,
      to: "First response overdue",
    });

    // Notify assigned agent or owners
    if (ticket.assigned_agent_id) {
      await createNotification(ticket.org_id, {
        agentId: ticket.assigned_agent_id,
        ticketId: ticket.id,
        type: "sla_breached",
        title: "SLA Breached: First Response Overdue",
        body: `Ticket #${ticket.id} (${ticket.subject}) missed its first response SLA deadline.`,
      });
    } else {
      const owners = await query<{ id: number }>(
        `SELECT id FROM agents WHERE org_id = ? AND role = 'owner'`,
        [ticket.org_id],
      );
      for (const owner of owners) {
        await createNotification(ticket.org_id, {
          agentId: owner.id,
          ticketId: ticket.id,
          type: "sla_breached",
          title: "SLA Breached: Unassigned Ticket Overdue",
          body: `Unassigned ticket #${ticket.id} (${ticket.subject}) missed its first response SLA deadline.`,
        });
      }
    }

    result.sla.firstResponseBreaches++;
  }

  // 2. SLA Resolution Breaches
  const overdueResolutionTickets = await query<{
    id: number;
    org_id: number;
    subject: string;
    assigned_agent_id: number | null;
  }>(
    `SELECT t.id, t.org_id, t.subject, t.assigned_agent_id
       FROM tickets t
      WHERE t.resolved_at IS NULL
        AND t.sla_resolution_due_at IS NOT NULL
        AND t.sla_resolution_due_at < datetime('now')
        AND t.sla_resolution_breached = 0
        AND t.status NOT IN ('resolved', 'closed')
        ${orgFilter}`,
    orgParams,
  );

  for (const ticket of overdueResolutionTickets) {
    await execute(
      `UPDATE tickets
          SET sla_resolution_breached = 1,
              sla_breached = 1
        WHERE id = ? AND org_id = ?`,
      [ticket.id, ticket.org_id],
    );

    await recordEvent(ticket.org_id, ticket.id, "sla_breached", {
      from: null,
      to: "Resolution overdue",
    });

    if (ticket.assigned_agent_id) {
      await createNotification(ticket.org_id, {
        agentId: ticket.assigned_agent_id,
        ticketId: ticket.id,
        type: "sla_breached",
        title: "SLA Breached: Resolution Overdue",
        body: `Ticket #${ticket.id} (${ticket.subject}) missed its resolution SLA deadline.`,
      });
    }

    result.sla.resolutionBreaches++;
  }

  // 3. SLA Warnings (due in < 1 hour and not yet warned)
  const nearingBreachTickets = await query<{
    id: number;
    org_id: number;
    subject: string;
    assigned_agent_id: number | null;
  }>(
    `SELECT t.id, t.org_id, t.subject, t.assigned_agent_id
       FROM tickets t
      WHERE t.first_response_at IS NULL
        AND t.sla_first_response_due_at IS NOT NULL
        AND t.sla_first_response_due_at BETWEEN datetime('now') AND datetime('now', '+1 hour')
        AND t.sla_first_response_breached = 0
        AND t.status NOT IN ('resolved', 'closed')
        AND t.id NOT IN (
          SELECT n.ticket_id FROM notifications n
           WHERE n.ticket_id = t.id AND n.type = 'sla_warning'
        )
        ${orgFilter}`,
    orgParams,
  );

  for (const ticket of nearingBreachTickets) {
    if (ticket.assigned_agent_id) {
      await recordEvent(ticket.org_id, ticket.id, "sla_warning", {
        to: "First response due in under 1 hour",
      });

      await createNotification(ticket.org_id, {
        agentId: ticket.assigned_agent_id,
        ticketId: ticket.id,
        type: "sla_warning",
        title: "SLA Warning: Response Due Soon",
        body: `Ticket #${ticket.id} (${ticket.subject}) first response is due in less than 1 hour.`,
      });
      result.sla.warningsIssued++;
    }
  }

  // 4. Auto-close resolved tickets older than 7 days
  const staleTickets = await query<{
    id: number;
    org_id: number;
  }>(
    `SELECT id, org_id
       FROM tickets
      WHERE status = 'resolved'
        AND resolved_at IS NOT NULL
        AND resolved_at < datetime('now', '-7 days')
        ${options.orgId ? "AND org_id = ?" : ""}`,
    orgParams,
  );

  for (const ticket of staleTickets) {
    const updated = await executeCounting(
      `UPDATE tickets
          SET status = 'closed',
              updated_at = datetime('now')
        WHERE id = ? AND org_id = ? AND status = 'resolved'`,
      [ticket.id, ticket.org_id],
    );

    if (updated > 0) {
      await recordEvent(ticket.org_id, ticket.id, "status_changed", {
        from: "resolved",
        to: "closed",
      });
      result.autoClosed++;
    }
  }

  // 5. Inbound Mail Polling (if mailbox is configured)
  const credentials = inboundCredentials();
  if (credentials) {
    result.mail.polled = true;
    const orgs = await query<Organization>(
      `SELECT * FROM organizations
        WHERE inbound_slug IS NOT NULL
        ${options.orgId ? "AND id = ?" : ""}`,
      orgParams,
    );

    for (const org of orgs) {
      result.mail.orgsChecked++;
      try {
        const mailSummary = await fetchInboundMail(org);
        result.mail.messagesCreated += mailSummary.created;
        result.mail.messagesAppended += mailSummary.appended;
      } catch (err) {
        console.error(`Scheduler mail check failed for org ${org.name}:`, err);
      }
    }
  }

  return result;
}
