import { NextResponse, type NextRequest } from "next/server";

import { CUSTOMER_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";

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
  const { pathname } = request.nextUrl;

  // The portal is a second realm with its own cookie. Its sign-in page lives
  // under the organization's own slug, so the redirect is built from the path
  // rather than being a fixed one.
  const portal = pathname.match(/^\/o\/([^/]+)\/support\/tickets/);

  if (portal) {
    if (request.cookies.has(CUSTOMER_SESSION_COOKIE)) return NextResponse.next();

    const url = request.nextUrl.clone();
    url.pathname = `/o/${portal[1]}/support/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/tickets/:path*",
    "/settings/:path*",
    "/o/:orgSlug/support/tickets/:path*",
  ],
};
