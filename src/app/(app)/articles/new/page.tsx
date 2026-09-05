import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { listCategories } from "@/lib/kb-categories";
import { getOrganization } from "@/lib/orgs";

import { ArticleForm } from "../ArticleForm";

export default async function NewArticlePage() {
  const session = await requireSession();
  const categories = await listCategories(session.orgId);
  const org = await getOrganization(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ marginBottom: "6px" }}>
            <Link href="/articles" className="hint">
              ← Back to articles
            </Link>
          </div>
          <h1>New Article</h1>
          <p>
            Draft or publish a knowledge base article for {session.orgName}.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <ArticleForm
          mode="create"
          categories={categories}
          portalSlug={org?.portal_slug ?? ""}
        />
      </div>
    </>
  );
}
