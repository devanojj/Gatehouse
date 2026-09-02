import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";

import { pollAllInboxes } from "@/lib/inbound";
import { inboundCredentials } from "@/lib/orgs";

/**
 * Scheduled inbound mail collection.
 *
 * Not a customer-facing endpoint: it authenticates with `CRON_SECRET` through
 * the standard `Authorization: Bearer …` header that Vercel Cron sends, and it
 * takes nothing else from the request — no organization id, no slug, no ticket
 * number. Every message is routed by the same slug rules the manual button
 * uses, through the same `fetchInboundMail`.
 *
 * With no secret configured the route refuses to run at all rather than
 * defaulting to open.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("Inbound cron called but CRON_SECRET is not set.");
    return json({ error: "Scheduled polling is not configured." }, 503);
  }

  const offered = request.headers.get("authorization") ?? "";
  if (!matches(offered, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized." }, 401);
  }

  // Answered after the secret check, so an unauthenticated caller learns
  // nothing about how this deployment is configured.
  if (!inboundCredentials()) {
    return json({ error: "The shared inbox is not configured." }, 503);
  }

  try {
    const results = await pollAllInboxes();

    const totals = results.reduce(
      (running, result) => ({
        organizations: running.organizations + 1,
        created: running.created + (result.summary?.created ?? 0),
        appended: running.appended + (result.summary?.appended ?? 0),
        reopened: running.reopened + (result.summary?.reopened ?? 0),
        failed: running.failed + (result.summary?.failed ?? 0),
        errored: running.errored + (result.error ? 1 : 0),
      }),
      {
        organizations: 0,
        created: 0,
        appended: 0,
        reopened: 0,
        failed: 0,
        errored: 0,
      },
    );

    if (totals.created > 0 || totals.appended > 0) {
      revalidatePath("/tickets");
    }

    console.log("Inbound cron finished:", JSON.stringify(totals));

    // Per-organization detail stays in the server log. The response says what
    // happened without naming tenants to whoever holds the secret.
    return json({ ok: true, ...totals });
  } catch (error) {
    console.error("Inbound cron failed:", error);
    return json({ error: "The scheduled poll could not run." }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Constant-time comparison, so the secret cannot be guessed byte by byte. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
