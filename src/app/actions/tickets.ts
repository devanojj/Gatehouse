"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { createComment, isAgentCommentType } from "@/lib/comments";
import { recordEvent } from "@/lib/events";
import { getQueue } from "@/lib/queues";
import { getOrganization } from "@/lib/orgs";
import { createNotification } from "@/lib/notifications";
import { sendTicketReply } from "@/lib/ticket-mail";
import {
  bulkUpdateTickets,
  canTransition,
  claimTicket,
  createTicket,
  getTicket,
  isPriority,
  isStatus,
  markFirstResponse,
  updateQueue,
  touchTicket,
  updateAssignee,
  updatePriority,
  updateStatus,
} from "@/lib/tickets";

import type { BulkUpdateParams, Ticket } from "@/lib/tickets";

/** What the timeline shows in place of an assignee's name. */
const UNASSIGNED = "Unassigned";

const CLOSED_MESSAGE =
  "This ticket is closed. An owner can reopen it before it is changed.";

/**
 * A closed ticket is a finished record: nothing about it changes until somebody
 * with the authority reopens it. `setStatusAction` handles that one exception
 * itself; every other write goes through here first.
 */
function assertMutable(ticket: Ticket): void {
  if (ticket.status === "closed") throw new Error(CLOSED_MESSAGE);
}

export type TicketFormState = {
  error?: string;
  /** The comment was saved, but the email alongside it was not sent. */
  warning?: string;
};

/**
 * Resolves a ticket id from a form against the caller's own org.
 *
 * Server Actions are reachable by direct POST, so the id arriving from the
 * client is treated as untrusted: it is only ever used together with the
 * session's org_id, and a ticket in another tenant reads as "not found".
 */
async function requireTicketAccess(formData: FormData) {
  const session = await requireSession();
  const ticketId = Number(formData.get("ticketId"));

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new Error("Invalid ticket.");
  }

  const ticket = await getTicket(session.orgId, ticketId);
  if (!ticket) throw new Error("Ticket not found.");

  return { session, ticket, ticketId };
}

export async function createTicketAction(
  _prev: TicketFormState | undefined,
  formData: FormData,
): Promise<TicketFormState> {
  const session = await requireSession();

  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const requesterEmail = String(formData.get("requesterEmail") ?? "").trim();
  const priority = formData.get("priority");

  if (!subject) return { error: "Subject is required." };
  if (!isPriority(priority)) return { error: "Choose a valid priority." };

  const id = await createTicket(session.orgId, {
    subject,
    description: description || null,
    priority,
    requesterEmail: requesterEmail || null,
    actorAgentId: session.agentId,
    source: "agent",
  });

  revalidatePath("/tickets");
  redirect(`/tickets/${id}`);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const status = formData.get("status");

  if (!isStatus(status)) throw new Error("Invalid status.");

  // Re-selecting the value the ticket already has is not history.
  if (status === ticket.status) return;

  // Reopening a closed ticket is the one change a closed ticket allows, and
  // only an owner may make it.
  if (ticket.status === "closed" && session.role !== "owner") {
    throw new Error(CLOSED_MESSAGE);
  }

  if (!canTransition(ticket.status, status)) {
    throw new Error(
      `A ticket cannot move from ${ticket.status} to ${status}.`,
    );
  }

  await updateStatus(session.orgId, ticketId, status);
  await recordEvent(session.orgId, ticketId, "status_changed", {
    actorAgentId: session.agentId,
    from: ticket.status,
    to: status,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setPriorityAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const priority = formData.get("priority");

  if (!isPriority(priority)) throw new Error("Invalid priority.");
  assertMutable(ticket);
  if (priority === ticket.priority) return;

  await updatePriority(session.orgId, ticketId, priority);
  await recordEvent(session.orgId, ticketId, "priority_changed", {
    actorAgentId: session.agentId,
    from: ticket.priority,
    to: priority,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setAssigneeAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const raw = String(formData.get("assignedAgentId") ?? "");
  const agentId = raw === "" ? null : Number(raw);

  if (agentId !== null && !Number.isInteger(agentId)) {
    throw new Error("Invalid assignee.");
  }

  assertMutable(ticket);
  if (agentId === ticket.assigned_agent_id) return;

  await updateAssignee(session.orgId, ticketId, agentId);

  // Read the assignee back rather than trusting the submitted id: an agent from
  // another tenant resolves to NULL in `updateAssignee`, and the timeline has to
  // record what actually happened, not what was asked for.
  const updated = await getTicket(session.orgId, ticketId);
  await recordEvent(session.orgId, ticketId, "assignee_changed", {
    actorAgentId: session.agentId,
    from: ticket.assigned_agent_name ?? UNASSIGNED,
    to: updated?.assigned_agent_name ?? UNASSIGNED,
  });

  if (
    updated?.assigned_agent_id &&
    updated.assigned_agent_id !== session.agentId
  ) {
    await createNotification(session.orgId, {
      agentId: updated.assigned_agent_id,
      ticketId,
      type: "ticket_assigned",
      title: "Ticket Assigned",
      body: `You were assigned ticket #${ticketId} ("${ticket.subject}") by ${session.agentName}.`,
    });
  }

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setQueueAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const queueId = Number(formData.get("queueId"));

  if (!Number.isInteger(queueId) || queueId <= 0) {
    throw new Error("Invalid queue.");
  }

  assertMutable(ticket);
  if (queueId === ticket.queue_id) return;

  // Resolved against this org before it is used for anything, including the
  // name written to the timeline.
  const queue = await getQueue(session.orgId, queueId);
  if (!queue) throw new Error("Queue not found.");

  await updateQueue(session.orgId, ticketId, queue.id);
  await recordEvent(session.orgId, ticketId, "queue_changed", {
    actorAgentId: session.agentId,
    from: ticket.queue_name,
    to: queue.name,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

/**
 * Takes an unassigned ticket.
 *
 * Losing the race is not an error: the claim simply did not apply, and the
 * revalidated page shows whoever did get it. Only the winner writes an event.
 */
export async function claimTicketAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);

  assertMutable(ticket);

  const claimed = await claimTicket(session.orgId, ticketId, session.agentId);

  if (claimed) {
    await recordEvent(session.orgId, ticketId, "assignee_changed", {
      actorAgentId: session.agentId,
      from: UNASSIGNED,
      to: session.agentName,
    });
  }

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function addCommentAction(
  _prev: TicketFormState | undefined,
  formData: FormData,
): Promise<TicketFormState> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);

  const body = String(formData.get("body") ?? "").trim();
  const type = formData.get("type");

  if (!body) return { error: "Write something before posting." };
  if (!isAgentCommentType(type)) return { error: "Invalid comment type." };
  if (ticket.status === "closed") return { error: CLOSED_MESSAGE };

  await createComment(session.orgId, ticketId, session.agentId, type, body, {
    authorEmail: session.agentEmail,
  });
  await touchTicket(session.orgId, ticketId);

  // First response is measured from the first reply the client can see, so an
  // internal note does not stop the clock.
  if (type === "public") await markFirstResponse(session.orgId, ticketId);

  // "Send and wait for a reply" — one action rather than a reply followed by a
  // separate status change nobody remembers to make.
  const waitForReply = formData.get("waitForReply") === "on";

  if (
    waitForReply &&
    type === "public" &&
    canTransition(ticket.status, "pending_customer")
  ) {
    await updateStatus(session.orgId, ticketId, "pending_customer");
    await recordEvent(session.orgId, ticketId, "status_changed", {
      actorAgentId: session.agentId,
      from: ticket.status,
      to: "pending_customer",
    });
    revalidatePath("/tickets");
  }

  revalidatePath(`/tickets/${ticketId}`);

  if (type === "internal") return {};

  // A public reply is meant to reach the requester. The comment is already
  // saved at this point, so a mail failure is reported as a warning rather than
  // thrown away with the agent's text.
  if (!ticket.requester_email) {
    return {
      warning:
        "Saved to the ticket, but not emailed: this ticket has no requester address.",
    };
  }

  try {
    const org = await getOrganization(session.orgId);
    if (!org) throw new Error("Organization not found.");
    await sendTicketReply(org, ticket, body, session.agentName);
  } catch (error) {
    console.error("Ticket reply could not be sent:", error);
    return {
      warning: `Saved to the ticket, but the email to ${ticket.requester_email} could not be sent.`,
    };
  }

  return {};
}

/**
 * Applies a bulk modification across multiple tickets within the caller's org.
 */
export async function bulkUpdateTicketsAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const ticketIds = formData
    .getAll("ticketId")
    .map((v) => Number(v))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (ticketIds.length === 0) return;

  const action = formData.get("action");
  let updateParams: BulkUpdateParams;

  if (action === "status") {
    const status = formData.get("status");
    if (!isStatus(status)) throw new Error("Invalid status.");
    updateParams = { action: "status", status };
  } else if (action === "priority") {
    const priority = formData.get("priority");
    if (!isPriority(priority)) throw new Error("Invalid priority.");
    updateParams = { action: "priority", priority };
  } else if (action === "assignee") {
    const raw = String(formData.get("assignedAgentId") ?? "");
    const agentId = raw === "" ? null : Number(raw);
    if (agentId !== null && !Number.isInteger(agentId)) {
      throw new Error("Invalid assignee.");
    }
    updateParams = { action: "assignee", assignedAgentId: agentId };
  } else if (action === "queue") {
    const queueId = Number(formData.get("queueId"));
    if (!Number.isInteger(queueId) || queueId <= 0) {
      throw new Error("Invalid queue.");
    }
    const queue = await getQueue(session.orgId, queueId);
    if (!queue) throw new Error("Queue not found.");
    updateParams = { action: "queue", queueId: queue.id };
  } else {
    throw new Error("Unknown bulk action.");
  }

  await bulkUpdateTickets(session.orgId, ticketIds, updateParams, {
    agentId: session.agentId,
    role: session.role,
  });

  revalidatePath("/tickets");
  for (const id of ticketIds) {
    revalidatePath(`/tickets/${id}`);
  }
}
