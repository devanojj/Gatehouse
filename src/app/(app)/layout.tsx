import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { requireSession } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/notifications";
import { GatehouseMark } from "@/app/ui/Logo";
import { NavLink } from "@/app/ui/NavLink";

/**
 * The gate itself. Every route under `/tickets` and `/settings` renders inside
 * this layout, and `requireSession()` runs server-side on each request before
 * any child page does — the pages then re-derive the session for their own
 * queries rather than trusting anything passed down.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const unreadCount = await countUnreadNotifications(
    session.orgId,
    session.agentId,
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="logo" href="/tickets">
            <GatehouseMark />
            Gatehouse
          </Link>

          <nav className="topbar-nav">
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/tickets">Tickets</NavLink>
            <NavLink href="/articles">Knowledge Base</NavLink>
            <NavLink href="/reports">Reports</NavLink>
            <NavLink href="/settings/inbox">Inbox</NavLink>
            {session.role === "owner" ? (
              <>
                <NavLink href="/settings/queues">Queues</NavLink>
                <NavLink href="/settings/routing">Routing</NavLink>
                <NavLink href="/settings/sla">SLA</NavLink>
                <NavLink href="/settings/audit">Audit</NavLink>
                <NavLink href="/settings/team">Team</NavLink>
              </>
            ) : (
              <NavLink href="/settings/audit">Audit</NavLink>
            )}
          </nav>

          <form className="topbar-search" action="/tickets" role="search">
            <input
              type="search"
              name="q"
              aria-label="Search tickets"
              placeholder="Search tickets…"
            />
          </form>

          <div className="topbar-right">
            <Link
              href="/notifications"
              className="topbar-bell"
              title="Notifications"
              aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 ? (
                <span className="bell-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Link>

            <div className="whoami">
              <div className="whoami-name">{session.agentName}</div>
              <div className="whoami-org">{session.orgName}</div>
            </div>
            <form action={logout}>
              <button className="btn-link" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
