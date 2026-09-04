"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { createComment, isAgentCommentType } from "@/lib/comments";
import { recordEvent } from "@/lib/events";
import { getOrganization } from "@/lib/orgs";
import { sendTicketReply } from "@/lib/ticket-mail";
import {
  createTicket,
  getTicket,
  isPriority,
  isStatus,
  markFirstResponse,
  touchTicket,
  updateAssignee,
  updatePriority,
  updateStatus,
} from "@/lib/tickets";

/** What the timeline shows in place of an assignee's name. */
const UNASSIGNED = "Unassigned";

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

  await createComment(session.orgId, ticketId, session.agentId, type, body, {
    authorEmail: session.agentEmail,
  });
  await touchTicket(session.orgId, ticketId);

  // First response is measured from the first reply the client can see, so an
  // internal note does not stop the clock.
  if (type === "public") await markFirstResponse(session.orgId, ticketId);

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
