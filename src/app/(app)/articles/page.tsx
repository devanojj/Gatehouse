import Link from "next/link";

import { requireSession } from "@/lib/auth";
import {
  countArticles,
  isArticleStatus,
  listArticles,
  type ArticleFilters,
  type ArticleStatus,
} from "@/lib/articles";
import { listCategories } from "@/lib/kb-categories";
import { getOrganization } from "@/lib/orgs";
import { formatDate } from "@/lib/format";

type Params = {
  q?: string;
  status?: string;
  category?: string;
};

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const q = params.q?.trim() || "";
  const statusParam = params.status?.trim();
  const categoryParam = params.category?.trim() || "";

  const activeStatus: ArticleStatus | undefined = isArticleStatus(statusParam)
    ? statusParam
    : undefined;

  const filters: ArticleFilters = {
    search: q || undefined,
    status: activeStatus,
    categorySlug: categoryParam || undefined,
  };

  const [articles, counts, categories, org] = await Promise.all([
    listArticles(session.orgId, filters),
    countArticles(session.orgId),
    listCategories(session.orgId),
    getOrganization(session.orgId),
  ]);

  const portalSlug = org?.portal_slug ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Knowledge Base</h1>
          <p>Create and manage articles for your customer Help Center.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Link className="btn btn-secondary" href="/articles/categories">
            Manage categories
          </Link>
          <Link className="btn btn-primary" href="/articles/new">
            New article
          </Link>
        </div>
      </div>

      {/* Tabs & Search toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div className="filter-pills" style={{ display: "flex", gap: "6px" }}>
          <Link
            href={`/articles${categoryParam ? `?category=${encodeURIComponent(categoryParam)}` : ""}`}
            className={`btn btn-sm ${!activeStatus ? "btn-primary" : "btn-secondary"}`}
          >
            All ({counts.total})
          </Link>
          <Link
            href={`/articles?status=published${categoryParam ? `&category=${encodeURIComponent(categoryParam)}` : ""}`}
            className={`btn btn-sm ${activeStatus === "published" ? "btn-primary" : "btn-secondary"}`}
          >
            Published ({counts.published})
          </Link>
          <Link
            href={`/articles?status=draft${categoryParam ? `&category=${encodeURIComponent(categoryParam)}` : ""}`}
            className={`btn btn-sm ${activeStatus === "draft" ? "btn-primary" : "btn-secondary"}`}
          >
            Drafts ({counts.draft})
          </Link>
        </div>

        <form
          method="get"
          action="/articles"
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
          {activeStatus ? (
            <input type="hidden" name="status" value={activeStatus} />
          ) : null}

          {categories.length > 0 ? (
            <select
              name="category"
              defaultValue={categoryParam}
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                height: "28px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}

          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search articles…"
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              height: "28px",
              width: "180px",
            }}
          />
          <button className="btn btn-secondary btn-sm" type="submit">
            Filter
          </button>
          {q || categoryParam ? (
            <Link
              href={`/articles${activeStatus ? `?status=${activeStatus}` : ""}`}
              className="hint"
              style={{ marginLeft: "4px" }}
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {/* Articles Table */}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Author</th>
                <th>Last updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="muted"
                    style={{ textAlign: "center", padding: "32px 16px" }}
                  >
                    {q || categoryParam || activeStatus
                      ? "No articles matched your filter criteria."
                      : "No knowledge base articles yet."}{" "}
                    <Link href="/articles/new">Write your first article</Link>.
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <Link
                        href={`/articles/${article.id}`}
                        style={{ fontWeight: 500, color: "var(--ink)" }}
                      >
                        {article.title}
                      </Link>
                      <div className="hint" style={{ fontSize: "11px" }}>
                        <code>/{article.slug}</code>
                      </div>
                    </td>
                    <td>
                      {article.category_name ? (
                        <span className="badge badge-gray">
                          {article.category_name}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {article.status === "published" ? (
                        <span className="badge badge-teal">Published</span>
                      ) : (
                        <span className="badge badge-amber">Draft</span>
                      )}
                    </td>
                    <td className="muted nowrap">
                      {article.author_name ?? "Staff"}
                    </td>
                    <td className="muted nowrap">
                      {formatDate(article.updated_at)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="btn-link"
                          href={`/articles/${article.id}`}
                        >
                          Edit
                        </Link>
                        {article.status === "published" && portalSlug ? (
                          <a
                            className="btn-link"
                            href={`/o/${portalSlug}/kb/${article.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
