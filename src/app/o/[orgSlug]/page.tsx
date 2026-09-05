import Link from "next/link";
import { notFound } from "next/navigation";

import { portalOrganization } from "@/lib/portal";

export default async function PortalHome({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  return (
    <div className="portal-hero">
      <h1>How can {org.name} help?</h1>
      <p>
        Tell us what happened and we will pick it up. You will get a reference
        number, and you can check on it here at any time.
      </p>

      <div className="portal-actions">
        <Link className="btn btn-primary" href={`/o/${orgSlug}/kb`}>
          Browse Help Center
        </Link>
        <Link className="btn btn-secondary" href={`/o/${orgSlug}/support/new`}>
          Raise a request
        </Link>
        <Link className="btn btn-secondary" href={`/o/${orgSlug}/support/login`}>
          Check an existing one
        </Link>
      </div>
    </div>
  );
}
