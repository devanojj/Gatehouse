"use server";

import { revalidatePath } from "next/cache";

import { requireOwner, requireSession } from "@/lib/auth";
import { fetchInboundMail, type InboundSummary } from "@/lib/inbound";
import { getOrganization, setSupportEmail } from "@/lib/orgs";

export type InboxCheckState = {
  error?: string;
  summary?: InboundSummary;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fetches this organization's mail on demand.
 *
 * The organization is taken from the session, never from the form, so the
 * button can only ever pull the caller's own mail out of the shared inbox.
 */
// Takes no arguments: there is nothing to submit, and the org comes from the
// session. `useActionState` still calls it with the previous state, which a
// zero-argument function simply ignores.
export async function checkInboundMailAction(): Promise<InboxCheckState> {
  const session = await requireSession();

  const org = await getOrganization(session.orgId);
  if (!org) return { error: "Organization not found." };

  try {
    const summary = await fetchInboundMail(org);

    if (summary.created > 0 || summary.appended > 0) {
      revalidatePath("/tickets");
    }

    return { summary };
  } catch (error) {
    console.error("Inbound mail check failed:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not reach the mailbox. Try again in a moment.",
    };
  }
}

export type SupportEmailState = {
  error?: string;
  saved?: boolean;
};

export async function updateSupportEmailAction(
  _prev: SupportEmailState | undefined,
  formData: FormData,
): Promise<SupportEmailState> {
  const session = await requireOwner();

  const supportEmail = String(formData.get("supportEmail") ?? "")
    .trim()
    .toLowerCase();

  if (supportEmail && !EMAIL_PATTERN.test(supportEmail)) {
    return { error: "Enter a valid email address, or leave it blank." };
  }

  await setSupportEmail(session.orgId, supportEmail || null);

  revalidatePath("/settings/inbox");
  return { saved: true };
}
