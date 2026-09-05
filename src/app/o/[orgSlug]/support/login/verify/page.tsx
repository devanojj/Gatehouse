import Link from "next/link";
import { notFound } from "next/navigation";

import { confirmCustomerLinkAction } from "@/app/actions/portal";
import { findUsableCustomerLink } from "@/lib/customer-auth";
import { portalOrganization } from "@/lib/portal";

/**
 * The link is checked on load but only *consumed* when the button is pressed.
 * A cookie cannot be set while a Server Component renders, and the extra step
 * keeps link-scanning mail clients from burning a single-use token before the
 * person clicks it.
 */
export default async function CustomerVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { orgSlug } = await params;
  const { token } = await searchParams;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const link = token ? await findUsableCustomerLink(token) : null;
  const usable = link !== null && link.org_id === org.id;

  if (!usable) {
    return (
      <div className="portal-panel portal-panel-narrow">
        <h1>That link no longer works</h1>
        <p className="muted">
          Links last 30 minutes and can only be used once. Ask for another and
          it will arrive in a moment.
        </p>
        <div className="portal-actions">
          <Link className="btn btn-primary" href={`/o/${orgSlug}/support/login`}>
            Send me a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-panel portal-panel-narrow">
      <h1>You&rsquo;re verified</h1>
      <p className="muted">Continue to see your requests to {org.name}.</p>

      <form action={confirmCustomerLinkAction}>
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="token" value={token} />
        <button className="btn btn-primary" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
