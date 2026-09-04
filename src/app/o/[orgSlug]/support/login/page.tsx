import { notFound } from "next/navigation";

import { portalOrganization } from "@/lib/portal";

import { CustomerLoginForm } from "./CustomerLoginForm";

export default async function CustomerLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const { orgSlug } = await params;
  const { expired } = await searchParams;

  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  return (
    <div className="portal-panel portal-panel-narrow">
      <h1>Check a request</h1>
      <p className="muted">See everything you have raised with {org.name}.</p>

      {expired ? (
        <p className="notice notice-info" role="status">
          That link had already been used or run out. Here is a fresh one.
        </p>
      ) : null}

      <div className="card card-pad">
        <CustomerLoginForm orgSlug={orgSlug} />
      </div>
    </div>
  );
}
