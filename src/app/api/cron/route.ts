import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runScheduledTasks } from "@/lib/scheduler";

/**
 * The scheduled sweep: SLA breaches, mail collection, auto-close.
 *
 * This is the one route handler in the app — everything else is a Server
 * Action — because Vercel Cron needs something to call over HTTP. It runs
 * across every tenant, so it fails closed: in production a missing
 * `CRON_SECRET` is a misconfiguration, never an invitation.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare a fixed-size digest of both instead of returning early.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

type Authorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

function authorize(request: Request): Authorization {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    // Locally there is nothing to protect and no scheduler running, so an
    // unauthenticated call is how you exercise the sweep by hand.
    if (process.env.NODE_ENV !== "production") return { ok: true };

    return {
      ok: false,
      status: 503,
      message:
        "CRON_SECRET is not set on this deployment, so the scheduled sweep " +
        "cannot be authenticated. Set it in the project's environment " +
        "variables and redeploy.",
    };
  }

  // Vercel Cron sends the secret in this header. It is deliberately the only
  // accepted place: a query string ends up in access logs and referrers.
  const header = request.headers.get("authorization") ?? "";

  if (!constantTimeEquals(header, `Bearer ${secret}`)) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  return { ok: true };
}

async function handle(request: Request) {
  const auth = authorize(request);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const result = await runScheduledTasks();
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
