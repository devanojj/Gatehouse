"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createComment } from "@/lib/comments";
import {
  endCustomerSession,
  getCustomerSession,
  sendCustomerMagicLink,
  startCustomerSessionFromMagicLink,
} from "@/lib/customer-auth";
import {
  findCustomer,
  findDuplicateSubmission,
  findOrCreateCustomer,
  normalizeEmail,
  recentTicketCount,
} from "@/lib/customers";
import { createNotification } from "@/lib/notifications";
import { findOrganizationByPortalSlug } from "@/lib/orgs";
import {
  createTicket,
  getCustomerTicket,
  reopenIfResolved,
  touchTicket,
} from "@/lib/tickets";

export type PortalFormState = {
  error?: string;
  notice?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How long the confirmation link opens the ticket it was issued for. */
const PUBLIC_TOKEN_HOURS = 72;

/** A second identical request this soon is the same request, submitted twice. */
const DUPLICATE_WINDOW_MINUTES = 5;

/** Enough for a bad afternoon, not enough to fill a queue. */
const MAX_TICKETS_PER_HOUR = 10;

/**
 * Resolves the portal being used.
 *
 * This is the one place an organization comes from the URL, and it is safe for
 * the same reason inbound routing by `+slug` is: it chooses which *public*
 * portal a stranger is standing in front of, and grants nothing. Everything
 * that reads existing data still requires a customer session, whose org comes
 * from the session row.
 */
async function requirePortalOrg(formData: FormData) {
  const slug = String(formData.get("orgSlug") ?? "").trim();
  const org = slug ? await findOrganizationByPortalSlug(slug) : null;

  if (!org || !org.portal_slug) throw new Error("Unknown support portal.");

  return org;
}

function publicToken(): string {
  return randomBytes(24).toString("hex");
}

function expiryTimestamp(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

export async function submitRequestAction(
  _prev: PortalFormState | undefined,
  formData: FormData,
): Promise<PortalFormState> {
  const org = await requirePortalOrg(formData);

  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { error: "Tell us your name so we know who to reply to." };
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter an email address we can reach you at." };
  }
  if (!subject) return { error: "Give your request a short summary." };
  if (!description) return { error: "Describe what happened so we can help." };

  // A double-submitted form should land on the ticket that already exists
  // rather than raising a second one.
  const duplicate = await findDuplicateSubmission(
    org.id,
    email,
    subject,
    DUPLICATE_WINDOW_MINUTES,
  );

  if (duplicate?.public_token) {
    redirect(`/o/${org.portal_slug}/support/confirmation/${duplicate.public_token}`);
  }

  if ((await recentTicketCount(org.id, email, 60)) >= MAX_TICKETS_PER_HOUR) {
    return {
      error:
        "That is a lot of requests in one hour. Reply to one of your open " +
        "tickets instead, and we will pick it up there.",
    };
  }

  const customer = await findOrCreateCustomer(org.id, email, name);
  const token = publicToken();

  await createTicket(org.id, {
    subject,
    description,
    priority: "medium",
    requesterEmail: email,
    requesterCustomerId: customer.id,
    publicToken: token,
    publicTokenExpiresAt: expiryTimestamp(PUBLIC_TOKEN_HOURS),
    source: "portal",
  });

  revalidatePath("/tickets");
  redirect(`/o/${org.portal_slug}/support/confirmation/${token}`);
}

/**
 * Emails a sign-in link — but only to an address this organization already
 * knows. The page says the same thing either way, so the portal cannot be used
 * to ask whether a given person is a customer of this tenant.
 */
export async function requestCustomerLinkAction(
  _prev: PortalFormState | undefined,
  formData: FormData,
): Promise<PortalFormState> {
  const org = await requirePortalOrg(formData);
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const customer = await findCustomer(org.id, email);

  if (customer) {
    await sendCustomerMagicLink(
      customer.id,
      customer.email,
      org.name,
      org.portal_slug!,
    );
  }

  return {
    notice: `If ${email} has raised a request with ${org.name}, a sign-in link is on its way.`,
  };
}

/**
 * Consumes the link and opens the session. Separate from rendering the verify
 * page so a mail client following links cannot burn a single-use token.
 */
export async function confirmCustomerLinkAction(
  formData: FormData,
): Promise<void> {
  const slug = String(formData.get("orgSlug") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  const started = token ? await startCustomerSessionFromMagicLink(token) : null;
  if (!started) redirect(`/o/${slug}/support/login?expired=1`);

  // The link belongs to one organization; opening it on another's portal is
  // not a session there.
  const org = await findOrganizationByPortalSlug(slug);
  if (!org || org.id !== started.orgId) {
    redirect(`/o/${slug}/support/login`);
  }

  redirect(`/o/${slug}/support/tickets`);
}

export async function customerLogoutAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("orgSlug") ?? "").trim();
  await endCustomerSession();
  redirect(`/o/${slug}/support/login`);
}

/**
 * A reply from the customer on their own ticket.
 *
 * The ticket is re-resolved against the session's org *and* customer id, so a
 * ticket number belonging to somebody else — or to another tenant — reads as
 * not found rather than accepting the message.
 */
export async function customerReplyAction(
  _prev: PortalFormState | undefined,
  formData: FormData,
): Promise<PortalFormState> {
  const session = await getCustomerSession();
  if (!session) return { error: "Your session has expired. Sign in again." };

  const ticketId = Number(formData.get("ticketId"));
  const body = String(formData.get("body") ?? "").trim();

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new Error("Invalid ticket.");
  }
  if (!body) return { error: "Write your message before sending." };

  const ticket = await getCustomerTicket(
    session.orgId,
    session.customerId,
    ticketId,
  );
  if (!ticket) throw new Error("Ticket not found.");

  if (ticket.status === "closed") {
    return {
      error: "This request is closed. Raise a new one and we will pick it up.",
    };
  }

  await createComment(session.orgId, ticketId, null, "inbound", body, {
    authorEmail: session.email,
  });
  await touchTicket(session.orgId, ticketId);
  await reopenIfResolved(session.orgId, ticket);

  if (ticket.assigned_agent_id) {
    await createNotification(session.orgId, {
      agentId: ticket.assigned_agent_id,
      ticketId,
      type: "customer_reply",
      title: "New Customer Reply",
      body: `Customer replied on ticket #${ticketId} ("${ticket.subject}"): "${body.slice(0, 100)}${body.length > 100 ? "…" : ""}"`,
    });
  }

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");

  return {};
}
