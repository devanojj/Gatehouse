"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { createComment, isCommentType } from "@/lib/comments";
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

export type TicketFormState = { error?: string };

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

  return { session, ticketId };
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
  });

  revalidatePath("/tickets");
  redirect(`/tickets/${id}`);
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const { session, ticketId } = await requireTicketAccess(formData);
  const status = formData.get("status");

  if (!isStatus(status)) throw new Error("Invalid status.");

  await updateStatus(session.orgId, ticketId, status);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setPriorityAction(formData: FormData): Promise<void> {
  const { session, ticketId } = await requireTicketAccess(formData);
  const priority = formData.get("priority");

  if (!isPriority(priority)) throw new Error("Invalid priority.");

  await updatePriority(session.orgId, ticketId, priority);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function setAssigneeAction(formData: FormData): Promise<void> {
  const { session, ticketId } = await requireTicketAccess(formData);
  const raw = String(formData.get("assignedAgentId") ?? "");
  const agentId = raw === "" ? null : Number(raw);

  if (agentId !== null && !Number.isInteger(agentId)) {
    throw new Error("Invalid assignee.");
  }

  await updateAssignee(session.orgId, ticketId, agentId);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
}

export async function addCommentAction(
  _prev: TicketFormState | undefined,
  formData: FormData,
): Promise<TicketFormState> {
  const { session, ticketId } = await requireTicketAccess(formData);

  const body = String(formData.get("body") ?? "").trim();
  const type = formData.get("type");

  if (!body) return { error: "Write something before posting." };
  if (!isCommentType(type)) return { error: "Invalid comment type." };

  await createComment(session.orgId, ticketId, session.agentId, type, body);
  await touchTicket(session.orgId, ticketId);

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}
