import "server-only";

import { cache } from "react";

import { findOrganizationByPortalSlug } from "./orgs";

import type { Comment } from "./comments";
import type { Status, Ticket } from "./tickets";

/**
 * The single place a ticket crosses from the agent side to the customer side.
 *
 * Both functions build a new object out of named fields rather than removing
 * fields from the row. A column added to `tickets` or `comments` tomorrow is
 * invisible here until somebody decides to add it — the failure mode is a
 * missing field on the portal, not a leaked one.
 */

/**
 * The organization whose portal is being viewed, memoized per render so the
 * layout and the page inside it share one lookup.
 */
export const portalOrganization = cache(async (slug: string) =>
  findOrganizationByPortalSlug(slug),
);

export type PortalTicket = {
  id: number;
  subject: string;
  description: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type PortalMessage = {
  id: number;
  /** Who the customer should see, never an internal display name. */
  author: string;
  body: string;
  created_at: string;
  fromClient: boolean;
};

/** Queue, assignee, priority, SLA timings and routing metadata stay behind. */
export function toPortalTicket(ticket: Ticket): PortalTicket {
  return {
    id: ticket.id,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    resolved_at: ticket.resolved_at,
  };
}

/**
 * Public replies and the customer's own messages, in order.
 *
 * Internal notes are dropped here, and this is the only conversion the portal
 * has — there is no path that renders a raw comment row to a customer.
 */
export function toPortalMessages(
  comments: Comment[],
  orgName: string,
): PortalMessage[] {
  return comments
    .filter((comment) => comment.type !== "internal")
    .map((comment) => ({
      id: comment.id,
      author: comment.type === "inbound" ? "You" : orgName,
      body: comment.body,
      created_at: comment.created_at,
      fromClient: comment.type === "inbound",
    }));
}

/**
 * Status wording for the person who raised the ticket. "Waiting on client" is
 * accurate on the agent side and meaningless on the customer's.
 */
export const CUSTOMER_STATUS_LABELS: Record<Status, string> = {
  open: "Received",
  in_progress: "Being worked on",
  pending_customer: "Waiting for your reply",
  resolved: "Resolved",
  closed: "Closed",
};

export const CUSTOMER_STATUS_TONE: Record<Status, string> = {
  open: "badge-amber",
  in_progress: "badge-blue",
  pending_customer: "badge-violet",
  resolved: "badge-teal",
  closed: "badge-gray",
};

/** Whether the customer can still add to this ticket. */
export function customerCanReply(ticket: PortalTicket): boolean {
  return ticket.status !== "closed";
}
