import "server-only";

import { cache } from "react";

import { findOrganizationByPortalSlug } from "./orgs";

import type { ArticleWithCategory } from "./articles";
import type { Comment } from "./comments";
import type { KbCategory, KbCategoryWithCount } from "./kb-categories";
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

export type PortalArticle = {
  id: number;
  title: string;
  slug: string;
  body: string;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  published_at: string | null;
  updated_at: string;
};

export type PortalCategory = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  article_count?: number;
};

/**
 * Public portal article projection.
 *
 * Strips operational and internal agent fields (author, org_id, draft status).
 * Returns null if the article is not published.
 */
export function toPortalArticle(
  article: ArticleWithCategory,
): PortalArticle | null {
  if (article.status !== "published") return null;
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    body: article.body,
    category_id: article.category_id,
    category_name: article.category_name,
    category_slug: article.category_slug,
    published_at: article.published_at,
    updated_at: article.updated_at,
  };
}

/**
 * Public portal category projection.
 */
export function toPortalCategory(
  category: KbCategory | KbCategoryWithCount,
): PortalCategory {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    position: category.position,
    article_count:
      "article_count" in category ? category.article_count : undefined,
  };
}

