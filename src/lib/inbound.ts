import "server-only";

import { createComment, messageAlreadyFiled } from "./comments";
import { inboundCredentials, type Organization } from "./orgs";
import { slugFromAddress } from "./slug";
import { ticketIdFromSubject } from "./ticket-mail";
import {
  createTicket,
  findOpenTicketByRequester,
  getTicket,
  touchTicket,
} from "./tickets";

/** One click never files more than this, so the action cannot run long. */
const MAX_MESSAGES_PER_CHECK = 25;

/**
 * How many unread messages to look at when deciding which are ours. Only
 * headers are pulled for these, so the pass is cheap — and doing it over the
 * whole unread backlog means another tenant's mail (or spam sent to the bare
 * address) cannot crowd this organization out of its own messages.
 */
const MAX_HEADERS_SCANNED = 500;

/** Headers that can carry the address a message was actually delivered to. */
const RECIPIENT_HEADERS = [
  "to",
  "cc",
  "delivered-to",
  "x-original-to",
  "x-forwarded-to",
  "envelope-to",
  "x-envelope-to",
];

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A message reduced to what routing actually needs. */
export type InboundMessage = {
  /** Stable identity used to avoid filing the same mail twice. */
  messageId: string;
  from: string;
  subject: string;
  body: string;
  /** Every address found across the recipient headers, lowercased. */
  recipients: string[];
};

export type FiledMessage =
  | { outcome: "created"; ticketId: number }
  | { outcome: "appended"; ticketId: number }
  | { outcome: "duplicate" };

export type InboundSummary = {
  /** Messages in the mailbox addressed to this organization. */
  matched: number;
  created: number;
  appended: number;
  duplicates: number;
  failed: number;
};

export function emptySummary(): InboundSummary {
  return { matched: 0, created: 0, appended: 0, duplicates: 0, failed: 0 };
}

// ------------------------------------------------------------------- routing

/**
 * Whether a message was addressed to this organization.
 *
 * Routing is by slug alone. An organization's `support_email` is self-declared
 * and unverified, so matching on it would let one tenant claim another's mail
 * by typing their address into a settings field.
 */
export function messageBelongsTo(
  message: InboundMessage,
  org: Organization,
): boolean {
  if (!org.inbound_slug) return false;
  return message.recipients.some(
    (address) => slugFromAddress(address) === org.inbound_slug,
  );
}

/**
 * Files one message into a ticket, in the order the routing rules say:
 *
 *   1. a `[Ticket #N]` marker in the subject, resolved inside this org;
 *   2. otherwise the sender's most recent ticket that is still open;
 *   3. otherwise a new ticket.
 *
 * Every lookup is scoped to `org.id`, so a ticket number belonging to another
 * tenant simply does not resolve and the message starts a fresh ticket here.
 */
export async function fileMessage(
  org: Organization,
  message: InboundMessage,
): Promise<FiledMessage> {
  if (await messageAlreadyFiled(org.id, message.messageId)) {
    return { outcome: "duplicate" };
  }

  const referenced = ticketIdFromSubject(message.subject);

  // A marker naming a ticket this org does not have — stale, or another
  // tenant's number — resolves to nothing and falls through to the sender's
  // own thread rather than reaching across the boundary.
  const existing =
    (referenced ? await getTicket(org.id, referenced) : null) ??
    (await findOpenTicketByRequester(org.id, message.from));

  if (existing) {
    await createComment(org.id, existing.id, null, "inbound", message.body, {
      authorEmail: message.from,
      messageId: message.messageId,
    });
    await touchTicket(org.id, existing.id);
    return { outcome: "appended", ticketId: existing.id };
  }

  const ticketId = await createTicket(org.id, {
    subject: message.subject,
    description: message.body,
    priority: "medium",
    requesterEmail: message.from,
    sourceMessageId: message.messageId,
  });

  return { outcome: "created", ticketId };
}

// ----------------------------------------------------------------- transport

type ParsedLike = {
  messageId?: string;
  subject?: string;
  text?: string;
  from?: { value: { address?: string }[] };
  headerLines?: readonly { key: string; line: string }[];
};

/**
 * Flattens a parsed MIME message into the shape routing works with.
 *
 * Recipients are scraped out of the raw header lines rather than the parsed
 * address objects: when an organization forwards its own support address here,
 * the `+slug` shows up only in `Delivered-To`, and duplicate delivery headers
 * are preserved in `headerLines` but collapsed elsewhere.
 */
export function toInboundMessage(
  parsed: ParsedLike,
  fallbackId: string,
): InboundMessage | null {
  const from = parsed.from?.value?.[0]?.address?.trim().toLowerCase();
  if (!from) return null;

  const recipients = new Set<string>();
  for (const header of parsed.headerLines ?? []) {
    if (!RECIPIENT_HEADERS.includes(header.key.toLowerCase())) continue;
    for (const address of header.line.match(ADDRESS) ?? []) {
      recipients.add(address.toLowerCase());
    }
  }

  return {
    messageId: parsed.messageId?.trim() || fallbackId,
    from,
    subject: parsed.subject?.trim() || "(no subject)",
    // HTML-only mail is out of scope for now; the ticket is still created so
    // nothing is silently dropped on the floor.
    body:
      parsed.text?.trim() ||
      "(This message had no plain-text part. Open it in the mailbox to read it.)",
    recipients: [...recipients],
  };
}

type HeaderFetcher = {
  fetch(
    range: string,
    query: { uid: true; headers: string[] },
    options: { uid: true },
  ): AsyncIterable<{ uid: number; headers?: Buffer }>;
};

/**
 * Narrows the unread backlog to the messages tagged for this organization,
 * reading only their recipient headers.
 *
 * The test here is deliberately loose — a `+slug@` anywhere in those headers —
 * because it decides only what is worth downloading in full. `messageBelongsTo`
 * makes the real call once the message is parsed.
 */
export async function selectOurs(
  client: HeaderFetcher,
  unread: number[],
  slug: string,
): Promise<number[]> {
  if (unread.length === 0) return [];

  const tag = `+${slug.toLowerCase()}@`;
  const ours: number[] = [];

  for await (const message of client.fetch(
    unread.join(","),
    { uid: true, headers: RECIPIENT_HEADERS },
    { uid: true },
  )) {
    if (!message.headers) continue;
    if (message.headers.toString("utf8").toLowerCase().includes(tag)) {
      ours.push(message.uid);
    }
    if (ours.length >= MAX_MESSAGES_PER_CHECK) break;
  }

  return ours;
}

/**
 * Pulls this organization's unread mail out of the shared inbox and files it.
 *
 * Only messages carrying this org's slug are touched: another tenant's mail is
 * left unread for their own check, so one workspace can never consume — or see
 * the count of — another's.
 */
export async function fetchInboundMail(
  org: Organization,
): Promise<InboundSummary> {
  const credentials = inboundCredentials();
  if (!credentials) {
    throw new Error(
      "The shared inbox is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.",
    );
  }
  if (!org.inbound_slug) {
    throw new Error("This workspace has no inbound address yet.");
  }

  // Imported here rather than at module scope so the IMAP client is only
  // loaded when someone actually checks for mail.
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: process.env.INBOUND_IMAP_HOST?.trim() || "imap.gmail.com",
    port: Number(process.env.INBOUND_IMAP_PORT ?? 993),
    secure: true,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });

  const summary = emptySummary();

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const found = await client.search({ seen: false }, { uid: true });
      // Oldest first, so a thread's messages land in the order they were sent.
      const unread = (found || []).slice(0, MAX_HEADERS_SCANNED);
      const uids = await selectOurs(client, unread, org.inbound_slug);

      for (const uid of uids) {
        const raw = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true },
        );
        if (!raw || !raw.source) continue;

        const message = toInboundMessage(
          await simpleParser(raw.source),
          `imap-uid-${uid}`,
        );
        // The header scan is a filter; this is the decision. A slug that only
        // shows up somewhere other than a recipient header does not count.
        if (!message || !messageBelongsTo(message, org)) continue;

        summary.matched++;

        try {
          const filed = await fileMessage(org, message);
          if (filed.outcome === "created") summary.created++;
          else if (filed.outcome === "appended") summary.appended++;
          else summary.duplicates++;

          // Only flag it once it is safely in the database — a message that
          // failed to file stays unread and is retried on the next check.
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        } catch (error) {
          console.error(`Inbound message ${message.messageId} failed:`, error);
          summary.failed++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return summary;
}
