import Link from "next/link";
import { notFound } from "next/navigation";

import { listArticles } from "@/lib/articles";
import { listCategoriesWithCounts } from "@/lib/kb-categories";
import { portalOrganization, toPortalArticle, toPortalCategory } from "@/lib/portal";

export default async function KnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { orgSlug } = await params;
  const org = await portalOrganization(orgSlug);
  if (!org) notFound();

  const { q: rawQ } = await searchParams;
  const q = rawQ?.trim() || "";

  if (q) {
    const rawArticles = await listArticles(org.id, {
      search: q,
      publishedOnly: true,
    });
    const articles = rawArticles
      .map(toPortalArticle)
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return (
      <div className="kb-container">
        <div className="kb-hero">
          <h1>Help Center</h1>
          <form className="kb-search-bar" action={`/o/${orgSlug}/kb`} role="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search help articles…"
              aria-label="Search help articles"
              autoFocus
            />
            <button className="btn btn-primary" type="submit">
              Search
            </button>
          </form>
        </div>

        <div className="kb-results-header">
          <Link href={`/o/${orgSlug}/kb`} className="hint">
            ← All categories
          </Link>
          <h2>
            {articles.length} {articles.length === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;
          </h2>
        </div>

        {articles.length === 0 ? (
          <div className="card card-pad" style={{ textAlign: "center", padding: "40px 20px" }}>
            <p className="muted" style={{ marginBottom: "16px" }}>
              We couldn&rsquo;t find any articles matching your search.
            </p>
            <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
              Submit a support ticket
            </Link>
          </div>
        ) : (
          <div className="card">
            <ul className="kb-article-list">
              {articles.map((article) => (
                <li key={article.id} className="kb-article-item">
                  <Link href={`/o/${orgSlug}/kb/${article.slug}`}>
                    <span className="kb-article-title">{article.title}</span>
                    {article.category_name ? (
                      <span className="badge badge-gray">{article.category_name}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="kb-deflection-banner">
          <div>
            <h3>Still need help?</h3>
            <p className="muted">Our team is happy to assist you directly.</p>
          </div>
          <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  // Browse view: Categories with published articles
  const [categoriesRaw, allArticlesRaw] = await Promise.all([
    listCategoriesWithCounts(org.id, { publishedOnly: true }),
    listArticles(org.id, { publishedOnly: true, limit: 100 }),
  ]);

  const categories = categoriesRaw.map((c) => toPortalCategory(c));
  const articles = allArticlesRaw
    .map(toPortalArticle)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  // Group articles by category
  const articlesByCat = new Map<number | null, typeof articles>();
  for (const article of articles) {
    const key = article.category_id;
    const list = articlesByCat.get(key) ?? [];
    list.push(article);
    articlesByCat.set(key, list);
  }

  const uncategorizedArticles = articlesByCat.get(null) ?? [];

  return (
    <div className="kb-container">
      <div className="kb-hero">
        <h1>How can we help?</h1>
        <p className="muted">Search our knowledge base or browse topics below.</p>
        <form className="kb-search-bar" action={`/o/${orgSlug}/kb`} role="search">
          <input
            type="search"
            name="q"
            placeholder="Search help articles…"
            aria-label="Search help articles"
          />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>
      </div>

      {categories.length === 0 && articles.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: "40px 20px" }}>
          <p className="muted" style={{ marginBottom: "16px" }}>
            No knowledge base articles have been published yet.
          </p>
          <Link className="btn btn-primary" href={`/o/${orgSlug}/support/new`}>
            Submit a support ticket
          </Link>
        </div>
      ) : (
        <div className="kb-category-grid">
          {categories.map((category) => {
            const catArticles = articlesByCat.get(category.id) ?? [];
            return (
              <div key={category.id} className="card kb-cat-card">
                <div className="kb-cat-head">
                  <Link href={`/o/${orgSlug}/kb/c/${category.slug}`} className="kb-cat-title">
                    {category.name}
                  </Link>
                  {category.description ? (
                    <p className="hint">{category.description}</p>
                  ) : null}
                </div>

                <ul className="kb-article-list">
                  {catArticles.slice(0, 5).map((art) => (
                    <li key={art.id} className="kb-article-item-compact">
                      <Link href={`/o/${orgSlug}/kb/${art.slug}`}>
                        {art.title}
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="kb-cat-foot">
                  <Link href={`/o/${orgSlug}/kb/c/${category.slug}`}>
                    View all {category.article_count ?? catArticles.length} articles →
                  </Link>
                </div>
              </div>
            );
          })}

          {uncategorizedArticles.length > 0 ? (
            <div className="card kb-cat-card">
              <div className="kb-cat-head">
                <span className="kb-cat-title">General Topics</span>
                <p className="hint">Additional guides and resources</p>
              </div>

              <ul className="kb-article-list">
                {uncategorizedArticles.slice(0, 5).map((art) => (
                  <li key={art.id} className="kb-article-item-compact">
                    <Link href={`/o/${orgSlug}/kb/${art.slug}`}>
                      {art.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
