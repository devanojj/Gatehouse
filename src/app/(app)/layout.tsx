import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { requireSession } from "@/lib/auth";
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

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="logo" href="/tickets">
            <GatehouseMark />
            Gatehouse
          </Link>

          <nav className="topbar-nav">
            <NavLink href="/tickets">Tickets</NavLink>
            <NavLink href="/settings/inbox">Inbox</NavLink>
            {session.role === "owner" ? (
              <NavLink href="/settings/team">Team</NavLink>
            ) : null}
          </nav>

          <div className="topbar-right">
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
