import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * An optimistic gate, not the real one.
 *
 * This only checks whether a session cookie is present, so an obviously
 * logged-out visitor is bounced before rendering. It deliberately does no
 * database work — proxy runs on prefetches too. The authoritative check is
 * `requireSession()` in the `(app)` layout, pages, and every server action,
 * which resolves the cookie against the `sessions` table.
 */
export function proxy(request: NextRequest) {
  const hasCookie = request.cookies.has(SESSION_COOKIE);

  if (!hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/tickets/:path*", "/settings/:path*"],
};
