import Link from "next/link";
import { notFound } from "next/navigation";

import { customerLogoutAction } from "@/app/actions/portal";
import { getCustomerSession } from "@/lib/customer-auth";
import { portalOrganization } from "@/lib/portal";
import { GatehouseMark } from "@/app/ui/Logo";

/**
 * The customer side of the house.
 *
 * The slug in the URL says which portal a visitor is looking at. It never says
 * whose tickets they may read — that comes from the customer session, and a
 * session for another organization is treated as signed out here.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const session = await getCustomerSession();
  const signedIn = session?.orgId === org.id;

  return (
    <div className="portal">
      <header className="portal-bar">
        <div className="portal-bar-inner">
          <Link className="logo" href={`/o/${orgSlug}`}>
            <GatehouseMark />
            {org.name}
          </Link>

          <nav className="portal-nav">
            <Link href={`/o/${orgSlug}/support/new`}>New request</Link>
            {signedIn ? (
              <>
                <Link href={`/o/${orgSlug}/support/tickets`}>My requests</Link>
                <form action={customerLogoutAction}>
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <button className="btn-link" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href={`/o/${orgSlug}/support/login`}>Check a request</Link>
            )}
          </nav>
        </div>
      </header>

      <main className="portal-main">{children}</main>

      <footer className="portal-foot">
        <p className="muted">Support for {org.name}, powered by Gatehouse.</p>
      </footer>
    </div>
  );
}
