"use server";

import { revalidatePath } from "next/cache";

import { requireOwner, requireSession } from "@/lib/auth";
import { runScheduledTasks, type SchedulerResult } from "@/lib/scheduler";
import { updateSlaTargets } from "@/lib/sla";

export async function saveSlaTargetsAction(formData: FormData): Promise<void> {
  const session = await requireOwner();

  const highResponse = Number(formData.get("high_response_hours"));
  const highResolution = Number(formData.get("high_resolution_hours"));
  const medResponse = Number(formData.get("medium_response_hours"));
  const medResolution = Number(formData.get("medium_resolution_hours"));
  const lowResponse = Number(formData.get("low_response_hours"));
  const lowResolution = Number(formData.get("low_resolution_hours"));

  if (
    !Number.isFinite(highResponse) ||
    !Number.isFinite(highResolution) ||
    !Number.isFinite(medResponse) ||
    !Number.isFinite(medResolution) ||
    !Number.isFinite(lowResponse) ||
    !Number.isFinite(lowResolution)
  ) {
    throw new Error("Invalid SLA target values.");
  }

  await updateSlaTargets(session.orgId, [
    {
      priority: "high",
      firstResponseHours: highResponse,
      resolutionHours: highResolution,
    },
    {
      priority: "medium",
      firstResponseHours: medResponse,
      resolutionHours: medResolution,
    },
    {
      priority: "low",
      firstResponseHours: lowResponse,
      resolutionHours: lowResolution,
    },
  ]);

  revalidatePath("/settings/sla");
  revalidatePath("/tickets");
}

export async function runSchedulerAction(): Promise<SchedulerResult> {
  const session = await requireSession();

  const result = await runScheduledTasks({ orgId: session.orgId });

  revalidatePath("/tickets");
  revalidatePath("/notifications");
  revalidatePath("/settings/sla");

  return result;
}
