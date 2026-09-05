import Link from "next/link";
import { notFound } from "next/navigation";

import { listArticles } from "@/lib/articles";
import { getCategoryBySlug } from "@/lib/kb-categories";
import { portalOrganization, toPortalArticle, toPortalCategory } from "@/lib/portal";

export default async function CategoryArticlesPage({
  params,
}: {
  params: Promise<{ orgSlug: string; categorySlug: string }>;
}) {
  const { orgSlug, categorySlug } = await params;
  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const categoryRaw = await getCategoryBySlug(org.id, categorySlug);
  if (!categoryRaw) notFound();

  const category = toPortalCategory(categoryRaw);
  const rawArticles = await listArticles(org.id, {
    categoryId: category.id,
    publishedOnly: true,
  });

  const articles = rawArticles
    .map(toPortalArticle)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <div className="kb-container">
      <div className="kb-breadcrumbs">
        <Link href={`/o/${orgSlug}/kb`}>Help Center</Link>
        <span className="kb-breadcrumb-separator">/</span>
        <span className="kb-breadcrumb-current">{category.name}</span>
      </div>

      <div className="kb-category-header">
        <h1>{category.name}</h1>
        {category.description ? (
          <p className="muted">{category.description}</p>
        ) : null}
      </div>

      {articles.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: "40px 20px" }}>
          <p className="muted" style={{ marginBottom: "16px" }}>
            No articles in this category yet.
          </p>
          <Link className="btn btn-secondary" href={`/o/${orgSlug}/kb`}>
            Back to Help Center
          </Link>
        </div>
      ) : (
        <div className="card">
          <ul className="kb-article-list">
            {articles.map((article) => (
              <li key={article.id} className="kb-article-item">
                <Link href={`/o/${orgSlug}/kb/${article.slug}`}>
                  <span className="kb-article-title">{article.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="kb-deflection-banner">
        <div>
          <h3>Can&rsquo;t find what you&rsquo;re looking for?</h3>
          <p className="muted">Submit a request and our support team will get right on it.</p>
        </div>
        <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
          Submit a ticket
        </Link>
      </div>
    </div>
  );
}
