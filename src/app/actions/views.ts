"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { createSavedView, deleteSavedView } from "@/lib/views";

/**
 * Creates a new named saved view for the caller's organization.
 */
export async function createSavedViewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const filters = String(formData.get("filters") ?? "").trim();

  if (!name) throw new Error("A view name is required.");

  await createSavedView(session.orgId, session.agentId, name, filters);
  revalidatePath("/tickets");
}

/**
 * Deletes a saved view if it belongs to the caller's organization.
 */
export async function deleteSavedViewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const viewId = Number(formData.get("viewId"));

  if (!Number.isInteger(viewId) || viewId <= 0) {
    throw new Error("Invalid view ID.");
  }

  await deleteSavedView(session.orgId, viewId);
  revalidatePath("/tickets");
}
