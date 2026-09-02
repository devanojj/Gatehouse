import { getAttachment, readAttachment } from "@/lib/attachments";
import { getSession } from "@/lib/auth";

/**
 * Downloading an attachment.
 *
 * The only route handler in Gatehouse, and a deliberate exception to "Server
 * Actions for everything": a browser has to be able to follow a plain link and
 * receive bytes, which an action cannot return.
 *
 * It is still the same authorization story as everywhere else. The session
 * comes from the cookie, the attachment id from the URL is resolved *inside*
 * that session's organization, and anything that does not resolve is a 404 —
 * one tenant cannot even learn whether another's attachment id exists. The
 * storage key never leaves the server.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return notFound();

  const { id } = await context.params;
  const attachmentId = Number(id);
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) return notFound();

  const attachment = await getAttachment(session.orgId, attachmentId);
  if (!attachment) return notFound();

  const bytes = await readAttachment(attachment);
  if (!bytes) {
    return new Response("This file is no longer in storage.", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      // The stored type, decided from the bytes at upload time — never the
      // content type the browser claimed. Served as a download with sniffing
      // off, so nothing can be talked into rendering in place.
      "Content-Type": attachment.content_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(attachment.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Filenames are already stripped of quotes, backslashes and control characters
 * when they are stored; the ASCII fallback drops anything else that could
 * confuse a header parser, and `filename*` carries the real name.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
