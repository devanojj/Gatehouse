"use server";

import { revalidatePath } from "next/cache";

import { createMember, findAgentByEmail, normalizeEmail } from "@/lib/agents";
import { requireOwner, sendMagicLink } from "@/lib/auth";

export type InviteFormState = {
  error?: string;
  invited?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function inviteAgent(
  _prev: InviteFormState | undefined,
  formData: FormData,
): Promise<InviteFormState> {
  const session = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!name) return { error: "Name is required." };
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const existing = await findAgentByEmail(email);
  if (existing) {
    return {
      error:
        existing.org_id === session.orgId
          ? "That person is already on your team."
          : "That email already belongs to another organization on Gatehouse.",
    };
  }

  const agentId = await createMember(session.orgId, name, email);
  await sendMagicLink(agentId, email, { isInvite: true });

  revalidatePath("/settings/team");
  return { invited: email };
}
