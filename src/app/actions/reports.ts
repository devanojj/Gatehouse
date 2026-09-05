"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth";
import { seedSampleReportData } from "@/lib/reports";

export async function seedSampleDataAction(): Promise<void> {
  const session = await requireOwner();

  await seedSampleReportData(session.orgId, session.agentId);

  revalidatePath("/reports");
  revalidatePath("/dashboard");
  revalidatePath("/tickets");
}
