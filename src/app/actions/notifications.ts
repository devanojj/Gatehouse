"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";

export async function markNotificationReadAction(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const id = Number(formData.get("notificationId"));

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid notification.");
  }

  await markNotificationRead(session.orgId, session.agentId, id);

  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await requireSession();

  await markAllNotificationsRead(session.orgId, session.agentId);

  revalidatePath("/notifications");
}
