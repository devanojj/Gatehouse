"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth";
import {
  createRoutingRule,
  deleteRoutingRule,
  getRoutingRule,
  isRoutingField,
  isRoutingOperator,
  listRoutingRules,
  reorderRoutingRules,
  updateRoutingRule,
} from "@/lib/routing";
import { isPriority } from "@/lib/tickets";

export async function createRoutingRuleAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const matchField = formData.get("matchField");
  const matchOperator = formData.get("matchOperator");
  const matchValue = String(formData.get("matchValue") ?? "").trim();

  const rawQueueId = formData.get("targetQueueId");
  const targetQueueId = rawQueueId ? Number(rawQueueId) : null;

  const rawAgentId = formData.get("targetAgentId");
  const targetAgentId = rawAgentId ? Number(rawAgentId) : null;

  const rawPriority = formData.get("targetPriority");
  const targetPriority = isPriority(rawPriority) ? rawPriority : null;

  if (!name) {
    throw new Error("Rule name is required.");
  }
  if (!isRoutingField(matchField)) {
    throw new Error("Invalid condition field.");
  }
  if (!isRoutingOperator(matchOperator)) {
    throw new Error("Invalid condition operator.");
  }
  if (!matchValue) {
    throw new Error("Match value is required.");
  }

  await createRoutingRule(session.orgId, {
    name,
    description,
    matchField,
    matchOperator,
    matchValue,
    targetQueueId,
    targetAgentId,
    targetPriority,
  });

  revalidatePath("/settings/routing");
}

export async function toggleRoutingRuleAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOwner();

  const ruleId = Number(formData.get("ruleId"));
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid rule ID.");
  }

  const existing = await getRoutingRule(session.orgId, ruleId);
  if (!existing) {
    throw new Error("Routing rule not found.");
  }

  await updateRoutingRule(session.orgId, ruleId, {
    isActive: existing.is_active === 0,
  });

  revalidatePath("/settings/routing");
}

export async function moveRoutingRuleAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOwner();

  const ruleId = Number(formData.get("ruleId"));
  const direction = String(formData.get("direction") ?? "");

  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid rule ID.");
  }

  const rules = await listRoutingRules(session.orgId);
  const index = rules.findIndex((r) => r.id === ruleId);
  if (index === -1) return;

  const newIndex = direction === "up" ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= rules.length) return;

  const swapped = [...rules];
  const temp = swapped[index];
  swapped[index] = swapped[newIndex];
  swapped[newIndex] = temp;

  await reorderRoutingRules(
    session.orgId,
    swapped.map((r) => r.id),
  );

  revalidatePath("/settings/routing");
}

export async function deleteRoutingRuleAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOwner();

  const ruleId = Number(formData.get("ruleId"));
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid rule ID.");
  }

  await deleteRoutingRule(session.orgId, ruleId);

  revalidatePath("/settings/routing");
}
