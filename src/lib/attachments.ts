import "server-only";

import { randomBytes } from "node:crypto";

import { insert, query, queryOne } from "./db";
import { getObject, putObject } from "./storage";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_POST = 5;

export type Attachment = {
  id: number;
  org_id: number;
  ticket_id: number;
  comment_id: number | null;
  agent_id: number | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  created_at: string;
};

/**
 * What may be uploaded, keyed by extension.
 *
 * The browser's `type` on a `File` is chosen by the client and is never used:
 * the extension picks a row here, the bytes have to agree with it, and the
 * `mime` in this table is what gets stored and served back. Nothing that a
 * browser will execute in place is on the list — no HTML, no SVG.
 */
const ALLOWED: Record<
  string,
  { mime: string; magic?: readonly (readonly number[])[]; text?: true }
> = {
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  gif: { mime: "image/gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  zip: {
    mime: "application/zip",
    magic: [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
    ],
  },
  txt: { mime: "text/plain", text: true },
  log: { mime: "text/plain", text: true },
  csv: { mime: "text/csv", text: true },
  json: { mime: "application/json", text: true },
  md: { mime: "text/markdown", text: true },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED).sort();

/** Raised for anything an agent can fix by choosing a different file. */
export class AttachmentError extends Error {}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strips a filename down to something safe to store and to echo back in a
 * download header: no directories, no control characters, no quotes.
 */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 120) || "attachment";
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function looksLikeText(bytes: Buffer): boolean {
  // A NUL byte in the first kilobyte means this is not the log file it claims
  // to be. Everything else is left to the reader.
  return !bytes.subarray(0, 1024).includes(0);
}

/**
 * Validates one uploaded file and returns exactly what should be persisted.
 * Exported so the composer action can reject a bad file before writing
 * anything at all.
 */
export function inspectUpload(
  filename: string,
  bytes: Buffer,
): { filename: string; contentType: string; extension: string } {
  const name = safeFilename(filename);
  const extension = extensionOf(name);
  const allowed = ALLOWED[extension];

  if (!allowed) {
    throw new AttachmentError(
      `"${name}" is not a file type Gatehouse accepts. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    );
  }
  if (bytes.length === 0) {
    throw new AttachmentError(`"${name}" is empty.`);
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(
      `"${name}" is ${formatBytes(bytes.length)}; the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    );
  }

  if (allowed.magic) {
    const matches = allowed.magic.some((signature) =>
      signature.every((byte, index) => bytes[index] === byte),
    );
    if (!matches) {
      throw new AttachmentError(
        `"${name}" does not look like a ${extension.toUpperCase()} file.`,
      );
    }
  } else if (allowed.text && !looksLikeText(bytes)) {
    throw new AttachmentError(`"${name}" does not look like a text file.`);
  }

  return { filename: name, contentType: allowed.mime, extension };
}

function storageKey(orgId: number, ticketId: number, extension: string): string {
  return `org-${orgId}/ticket-${ticketId}/${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
}

/**
 * Stores the bytes, then records them against the ticket.
 *
 * The row is built by a SELECT over `tickets`, so it is only written when the
 * ticket is this organization's, and the comment id is resolved through the
 * same org as well — a stray id links to nothing rather than to a stranger's
 * conversation.
 */
export async function storeAttachment(
  orgId: number,
  ticketId: number,
  fields: {
    commentId: number | null;
    agentId: number | null;
    filename: string;
    bytes: Buffer;
  },
): Promise<number> {
  const inspected = inspectUpload(fields.filename, fields.bytes);

  // Checked before a byte is written, so a ticket in another tenant cannot
  // leave an orphaned object behind. The INSERT below re-checks it anyway.
  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM tickets WHERE id = ? AND org_id = ?`,
    [ticketId, orgId],
  );
  if (!owned) throw new Error("Ticket not found.");

  const key = storageKey(orgId, ticketId, inspected.extension);

  await putObject(key, fields.bytes, inspected.contentType);

  return insert(
    `INSERT INTO attachments
       (org_id, ticket_id, comment_id, agent_id, filename, content_type, size_bytes, storage_key)
     SELECT t.org_id,
            t.id,
            (SELECT c.id FROM comments c WHERE c.id = ? AND c.org_id = t.org_id),
            (SELECT a.id FROM agents a WHERE a.id = ? AND a.org_id = t.org_id),
            ?, ?, ?, ?
       FROM tickets t
      WHERE t.id = ? AND t.org_id = ?`,
    [
      fields.commentId,
      fields.agentId,
      inspected.filename,
      inspected.contentType,
      fields.bytes.length,
      key,
      ticketId,
      orgId,
    ],
  );
}

export async function listTicketAttachments(
  orgId: number,
  ticketId: number,
): Promise<Attachment[]> {
  return query<Attachment>(
    `SELECT * FROM attachments
      WHERE org_id = ? AND ticket_id = ?
      ORDER BY created_at, id`,
    [orgId, ticketId],
  );
}

/** The org check is the authorization check — the download route relies on it. */
export async function getAttachment(
  orgId: number,
  attachmentId: number,
): Promise<Attachment | null> {
  return queryOne<Attachment>(
    `SELECT * FROM attachments WHERE org_id = ? AND id = ?`,
    [orgId, attachmentId],
  );
}

export async function readAttachment(
  attachment: Attachment,
): Promise<Buffer | null> {
  return getObject(attachment.storage_key);
}
