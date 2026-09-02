import "server-only";

import { sendEmail } from "./email";
import { inboundAddressFor, type Organization } from "./orgs";
import type { Ticket } from "./tickets";

/**
 * The `[Ticket #12]` marker is how a reply finds its way back to the right
 * ticket: it goes out on every outbound message and is the first thing the
 * inbound fetcher looks for. Both directions read this one file so the
 * convention cannot drift apart.
 */
const TICKET_REF = /\[Ticket #(\d+)\]/i;

export function subjectWithTicketRef(ticketId: number, subject: string): string {
  const existing = subject.match(TICKET_REF);
  // A reply to our own mail already carries the marker — don't stack another.
  if (existing && Number(existing[1]) === ticketId) return subject;
  return `[Ticket #${ticketId}] ${subject}`;
}

export function ticketIdFromSubject(subject: string): number | null {
  const match = subject.match(TICKET_REF);
  if (!match) return null;

  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Sends an agent's public reply to the person who raised the ticket.
 *
 * The message goes out under the organization's name with Reply-To pointing at
 * their inbound address, so the customer sees the org rather than Gatehouse and
 * their answer comes back to the same ticket.
 */
export async function sendTicketReply(
  org: Organization,
  ticket: Ticket,
  body: string,
  agentName: string,
): Promise<void> {
  if (!ticket.requester_email) return;

  const replyTo = inboundAddressFor(org);

  const lines = [
    body,
    "",
    "—",
    `${agentName} · ${org.name}`,
  ];

  if (replyTo) {
    lines.push(
      "",
      "Reply to this email and your message will be added to the ticket.",
    );
  }

  await sendEmail(
    ticket.requester_email,
    subjectWithTicketRef(ticket.id, ticket.subject),
    lines.join("\n"),
    { fromName: org.name, replyTo },
  );
}
