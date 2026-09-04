import { notFound } from "next/navigation";

import { getCustomerSession } from "@/lib/customer-auth";
import { portalOrganization } from "@/lib/portal";

import { NewRequestForm } from "./NewRequestForm";

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  // A signed-in customer should not retype what we already know.
  const session = await getCustomerSession();
  const known = session?.orgId === org.id ? session : null;

  return (
    <div className="portal-panel">
      <h1>Raise a request</h1>
      <p className="muted">
        {org.name} will reply by email, and you can follow it here.
      </p>

      <div className="card card-pad">
        <NewRequestForm
          orgSlug={orgSlug}
          knownEmail={known?.email}
          knownName={known?.name ?? undefined}
        />
      </div>
    </div>
  );
}
