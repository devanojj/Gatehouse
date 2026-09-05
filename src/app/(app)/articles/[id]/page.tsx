import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth";
import { getArticle } from "@/lib/articles";
import { listCategories } from "@/lib/kb-categories";
import { getOrganization } from "@/lib/orgs";

import { ArticleForm } from "../ArticleForm";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const articleId = Number(rawId);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    notFound();
  }

  const session = await requireSession();
  const [article, categories, org] = await Promise.all([
    getArticle(session.orgId, articleId),
    listCategories(session.orgId),
    getOrganization(session.orgId),
  ]);

  if (!article) {
    notFound();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ marginBottom: "6px" }}>
            <Link href="/articles" className="hint">
              ← Back to articles
            </Link>
          </div>
          <h1>Edit Article</h1>
          <p>Update content, change publishing status, or manage slug.</p>
        </div>
      </div>

      <div className="card card-pad">
        <ArticleForm
          mode="edit"
          article={article}
          categories={categories}
          portalSlug={org?.portal_slug ?? ""}
        />
      </div>
    </>
  );
}
