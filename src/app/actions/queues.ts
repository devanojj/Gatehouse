"use server";

import { revalidatePath } from "next/cache";

import { getAgent } from "@/lib/agents";
import { requireOwner } from "@/lib/auth";
import {
  addQueueMember,
  createQueue,
  deleteQueue,
  findQueueByName,
  getQueue,
  QUEUE_DESCRIPTION_MAX,
  QUEUE_NAME_MAX,
  removeQueueMember,
  updateQueue,
} from "@/lib/queues";

export type QueueFormState = {
  error?: string;
  saved?: string;
};

/**
 * Queues decide who sees what, so creating and staffing them is owner work —
 * `requireOwner()` re-checks the session on every call, not just when the page
 * renders. Every id below is resolved inside that session's organization before
 * it is used.
 */
function readQueueId(formData: FormData): number {
  const queueId = Number(formData.get("queueId"));
  if (!Number.isInteger(queueId) || queueId <= 0) {
    throw new Error("Invalid queue.");
  }
  return queueId;
}

function readName(formData: FormData): string {
  return String(formData.get("name") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUEUE_NAME_MAX);
}

function readDescription(formData: FormData): string | null {
  const description = String(formData.get("description") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUEUE_DESCRIPTION_MAX);
  return description || null;
}

export async function createQueueAction(
  _prev: QueueFormState | undefined,
  formData: FormData,
): Promise<QueueFormState> {
  const session = await requireOwner();

  const name = readName(formData);
  if (!name) return { error: "Give the queue a name." };

  if (await findQueueByName(session.orgId, name)) {
    return { error: `You already have a queue called “${name}”.` };
  }

  await createQueue(session.orgId, name, readDescription(formData));

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
  return { saved: `Created ${name}.` };
}

export async function renameQueueAction(
  _prev: QueueFormState | undefined,
  formData: FormData,
): Promise<QueueFormState> {
  const session = await requireOwner();
  const queueId = readQueueId(formData);

  const queue = await getQueue(session.orgId, queueId);
  if (!queue) return { error: "That queue no longer exists." };

  const name = readName(formData);
  if (!name) return { error: "Give the queue a name." };

  const clash = await findQueueByName(session.orgId, name);
  if (clash && clash.id !== queue.id) {
    return { error: `You already have a queue called “${name}”.` };
  }

  await updateQueue(session.orgId, queue.id, name, readDescription(formData));

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
  return { saved: `Saved ${name}.` };
}

/**
 * Deleting is safe rather than blocked: the tickets in the queue keep every
 * other field and simply come back out of it, which `deleteQueue` does in the
 * same transaction as the delete itself.
 */
export async function deleteQueueAction(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const queueId = readQueueId(formData);

  const queue = await getQueue(session.orgId, queueId);
  if (!queue) throw new Error("Queue not found.");

  await deleteQueue(session.orgId, queue.id);

  revalidatePath("/settings/queues");
  revalidatePath("/tickets");
}

export async function addQueueMemberAction(
  _prev: QueueFormState | undefined,
  formData: FormData,
): Promise<QueueFormState> {
  const session = await requireOwner();
  const queueId = readQueueId(formData);

  const queue = await getQueue(session.orgId, queueId);
  if (!queue) return { error: "That queue no longer exists." };

  const agentId = Number(formData.get("agentId"));
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return { error: "Choose a teammate to add." };
  }

  // Both sides are re-resolved in this org before the membership row is built.
  const agent = await getAgent(session.orgId, agentId);
  if (!agent) return { error: "That teammate is not on your team." };

  await addQueueMember(session.orgId, queue.id, agent.id);

  revalidatePath("/settings/queues");
  return { saved: `${agent.name} is now in ${queue.name}.` };
}

export async function removeQueueMemberAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOwner();
  const queueId = readQueueId(formData);

  const agentId = Number(formData.get("agentId"));
  if (!Number.isInteger(agentId) || agentId <= 0) {
    throw new Error("Invalid teammate.");
  }

  await removeQueueMember(session.orgId, queueId, agentId);

  revalidatePath("/settings/queues");
}
