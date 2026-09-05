import Link from "next/link";
import { notFound } from "next/navigation";

import { getArticleBySlug } from "@/lib/articles";
import { formatDate } from "@/lib/format";
import { portalOrganization, toPortalArticle } from "@/lib/portal";

export default async function ArticleReaderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; articleSlug: string }>;
}) {
  const { orgSlug, articleSlug } = await params;
  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const rawArticle = await getArticleBySlug(org.id, articleSlug, {
    publishedOnly: true,
  });
  if (!rawArticle) notFound();

  const article = toPortalArticle(rawArticle);
  if (!article) notFound();

  return (
    <div className="kb-container">
      <div className="kb-breadcrumbs">
        <Link href={`/o/${orgSlug}/kb`}>Help Center</Link>
        {article.category_slug && article.category_name ? (
          <>
            <span className="kb-breadcrumb-separator">/</span>
            <Link href={`/o/${orgSlug}/kb/c/${article.category_slug}`}>
              {article.category_name}
            </Link>
          </>
        ) : null}
        <span className="kb-breadcrumb-separator">/</span>
        <span className="kb-breadcrumb-current">{article.title}</span>
      </div>

      <article className="card card-pad kb-reader-card">
        <header className="kb-reader-header">
          <h1>{article.title}</h1>
          <div className="hint" style={{ marginTop: "6px" }}>
            Updated {formatDate(article.updated_at)}
          </div>
        </header>

        <div className="kb-reader-body">
          {article.body.split(/\n\n+/).map((paragraph, index) => (
            <p key={index} style={{ marginBottom: "16px", whiteSpace: "pre-line" }}>
              {paragraph}
            </p>
          ))}
        </div>
      </article>

      <div className="kb-deflection-banner">
        <div>
          <h3>Was this article helpful?</h3>
          <p className="muted">
            If you still need assistance, our support team is here to help.
          </p>
        </div>
        <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
          Contact support
        </Link>
      </div>
    </div>
  );
}
