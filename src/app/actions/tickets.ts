"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getAgent } from "@/lib/agents";
import {
  AttachmentError,
  MAX_ATTACHMENTS_PER_POST,
  storeAttachment,
} from "@/lib/attachments";
import { requireSession } from "@/lib/auth";
import { createComment, isAgentCommentType } from "@/lib/comments";
import { getOrganization } from "@/lib/orgs";
import { getQueue, setTicketQueue } from "@/lib/queues";
import { sendTicketReply } from "@/lib/ticket-mail";
import {
  createTicket,
  getTicket,
  isPriority,
  isStatus,
  touchTicket,
  updateAssignee,
  updatePriority,
  updateStatus,
} from "@/lib/tickets";

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

/** An optional row id from a form: "" means none, anything else must be an id. */
function optionalId(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id.");
  return id;
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

  let queueId: number | null;
  try {
    queueId = optionalId(formData.get("queueId"));
  } catch {
    return { error: "Choose a valid queue." };
  }

  // A queue id from the form is only ever used after it resolves inside this
  // organization; another tenant's queue is simply not a queue here.
  if (queueId !== null && !(await getQueue(session.orgId, queueId))) {
    return { error: "That queue no longer exists." };
  }

  const id = await createTicket(
    session.orgId,
    {
      subject,
      description: description || null,
      priority,
      requesterEmail: requesterEmail || null,
      queueId,
    },
    { agentId: session.agentId },
  );

  revalidatePath("/tickets");
  redirect(`/tickets/${id}`);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const status = formData.get("status");

  if (!isStatus(status)) throw new Error("Invalid status.");

  await updateStatus(session.orgId, ticketId, status, {
    agentId: session.agentId,
    previous: ticket.status,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setPriorityAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);
  const priority = formData.get("priority");

  if (!isPriority(priority)) throw new Error("Invalid priority.");

  await updatePriority(session.orgId, ticketId, priority, {
    agentId: session.agentId,
    previous: ticket.priority,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setAssigneeAction(formData: FormData): Promise<void> {
  const { session, ticketId } = await requireTicketAccess(formData);
  const agentId = optionalId(formData.get("assignedAgentId"));

  // Re-resolved inside the session's org so the timeline records the teammate
  // who was really assigned, not whoever the form claimed.
  const agent = agentId === null ? null : await getAgent(session.orgId, agentId);
  if (agentId !== null && !agent) throw new Error("Assignee not found.");

  await updateAssignee(session.orgId, ticketId, agent?.id ?? null, {
    agentId: session.agentId,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

/** "Take it": the caller assigns the ticket to themselves. */
export async function claimTicketAction(formData: FormData): Promise<void> {
  const { session, ticket, ticketId } = await requireTicketAccess(formData);

  if (ticket.assigned_agent_id === session.agentId) return;

  await updateAssignee(session.orgId, ticketId, session.agentId, {
    agentId: session.agentId,
    claimed: true,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setTicketQueueAction(formData: FormData): Promise<void> {
  const { session, ticketId } = await requireTicketAccess(formData);
  const queueId = optionalId(formData.get("queueId"));

  const queue = queueId === null ? null : await getQueue(session.orgId, queueId);
  if (queueId !== null && !queue) throw new Error("Queue not found.");

  await setTicketQueue(session.orgId, ticketId, queue?.id ?? null, {
    agentId: session.agentId,
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

  if (!isAgentCommentType(type)) return { error: "Invalid comment type." };

  const files = formData
    .getAll("attachments")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!body && files.length === 0) {
    return { error: "Write something, or attach a file, before posting." };
  }
  if (files.length > MAX_ATTACHMENTS_PER_POST) {
    return {
      error: `Attach at most ${MAX_ATTACHMENTS_PER_POST} files to one message.`,
    };
  }

  const commentId = await createComment(
    session.orgId,
    ticketId,
    session.agentId,
    type,
    body,
    { authorEmail: session.agentEmail },
  );

  let attachmentWarning: string | undefined;

  for (const file of files) {
    try {
      await storeAttachment(session.orgId, ticketId, {
        commentId,
        agentId: session.agentId,
        filename: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
    } catch (error) {
      // The comment is already saved, so a rejected file is reported rather
      // than throwing the agent's text away with it.
      console.error("Attachment could not be stored:", error);
      attachmentWarning =
        error instanceof AttachmentError
          ? error.message
          : "A file could not be stored. The message itself was saved.";
      break;
    }
  }

  await touchTicket(session.orgId, ticketId);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");

  if (type === "internal") {
    return attachmentWarning ? { warning: attachmentWarning } : {};
  }

  // A public reply is meant to reach the requester. The comment is already
  // saved at this point, so a mail failure is reported as a warning rather than
  // thrown away with the agent's text.
  //
  // Files live on the ticket rather than on the outgoing mail, so an
  // attachment-only reply has nothing to send.
  if (!body) {
    return {
      warning: [
        attachmentWarning,
        "Added to the ticket. Nothing was emailed — an email needs some text.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  if (!ticket.requester_email) {
    return {
      warning: [
        attachmentWarning,
        "Saved to the ticket, but not emailed: this ticket has no requester address.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  try {
    const org = await getOrganization(session.orgId);
    if (!org) throw new Error("Organization not found.");
    await sendTicketReply(org, ticket, body, session.agentName);
  } catch (error) {
    console.error("Ticket reply could not be sent:", error);
    return {
      warning: [
        attachmentWarning,
        `Saved to the ticket, but the email to ${ticket.requester_email} could not be sent.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  return attachmentWarning ? { warning: attachmentWarning } : {};
}
