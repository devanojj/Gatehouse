"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth";
import {
  createQueue,
  deleteQueue,
  getQueue,
  renameQueue,
  setDefaultQueue,
} from "@/lib/queues";

export type QueueFormState = {
  error?: string;
  notice?: string;
};

const MAX_NAME = 60;

function readName(formData: FormData): string {
  return String(formData.get("name") ?? "").trim();
}

/**
 * Queue ids arrive from a form and are therefore untrusted. Every action below
 * re-resolves the id against the caller's own org before touching anything, the
 * same way `requireTicketAccess` does for tickets.
 */
async function requireQueue(formData: FormData) {
  const session = await requireOwner();
  const queueId = Number(formData.get("queueId"));

  if (!Number.isInteger(queueId) || queueId <= 0) {
    throw new Error("Invalid queue.");
  }

  const queue = await getQueue(session.orgId, queueId);
  if (!queue) throw new Error("Queue not found.");

  return { session, queue };
}

export async function createQueueAction(
  _prev: QueueFormState | undefined,
  formData: FormData,
): Promise<QueueFormState> {
  const session = await requireOwner();
  const name = readName(formData);

  if (!name) return { error: "Give the queue a name." };
  if (name.length > MAX_NAME) {
    return { error: `Keep the name under ${MAX_NAME} characters.` };
  }

  await createQueue(session.orgId, name);

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
  return { notice: `${name} is ready to receive tickets.` };
}

export async function renameQueueAction(
  _prev: QueueFormState | undefined,
  formData: FormData,
): Promise<QueueFormState> {
  const { session, queue } = await requireQueue(formData);
  const name = readName(formData);

  if (!name) return { error: "A queue needs a name." };
  if (name.length > MAX_NAME) {
    return { error: `Keep the name under ${MAX_NAME} characters.` };
  }
  if (name === queue.name) return {};

  await renameQueue(session.orgId, queue.id, name);

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
  return { notice: `Renamed to ${name}.` };
}

export async function setDefaultQueueAction(formData: FormData): Promise<void> {
  const { session, queue } = await requireQueue(formData);

  await setDefaultQueue(session.orgId, queue.id);

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
}

export async function deleteQueueAction(formData: FormData): Promise<void> {
  const { session, queue } = await requireQueue(formData);

  // The default is where deleted queues' tickets go, so it cannot be the one
  // being deleted. The UI hides the control; this is the same rule server-side.
  if (queue.is_default === 1) {
    throw new Error("Choose another default queue before deleting this one.");
  }

  await deleteQueue(session.orgId, queue.id);

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
}
