"use server";

import { redirect } from "next/navigation";

import {
  createOrganizationWithOwner,
  findAgentByEmail,
  normalizeEmail,
} from "@/lib/agents";
import { endSession, sendMagicLink, startSessionFromMagicLink } from "@/lib/auth";

export type AuthFormState = {
  error?: string;
  sentTo?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!orgName) return { error: "Organization name is required." };
  if (!name) return { error: "Your name is required." };
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  if (await findAgentByEmail(email)) {
    return {
      error:
        "That email is already registered. Sign in instead — an account belongs to exactly one organization.",
    };
  }

  const { agentId } = await createOrganizationWithOwner(orgName, name, email);
  await sendMagicLink(agentId, email);

  return { sentTo: email };
}

export async function login(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const agent = await findAgentByEmail(email);
  if (!agent) {
    return {
      error:
        "We couldn't find an account for that email. If your organization is new to Gatehouse, sign up instead.",
    };
  }

  await sendMagicLink(agent.id, agent.email);
  return { sentTo: agent.email };
}

/**
 * Consumes the magic link and opens a session.
 *
 * This runs as a POST from the verify page rather than on page load: a cookie
 * cannot be set while a Server Component renders, and it also keeps link
 * scanners in email clients from burning a single-use token on a GET.
 */
export async function completeSignIn(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");

  const ok = await startSessionFromMagicLink(token);
  if (!ok) redirect("/login?expired=1");

  redirect("/tickets");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
