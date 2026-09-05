"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  createArticleAction,
  deleteArticleAction,
  updateArticleAction,
  type ArticleFormState,
} from "@/app/actions/articles";
import type { ArticleWithCategory } from "@/lib/articles";
import type { KbCategory } from "@/lib/kb-categories";

const initial: ArticleFormState = {};

export function ArticleForm({
  mode,
  article,
  categories,
  portalSlug,
}: {
  mode: "create" | "edit";
  article?: ArticleWithCategory;
  categories: KbCategory[];
  portalSlug: string;
}) {
  const isEdit = mode === "edit" && article !== undefined;
  const actionFn = isEdit ? updateArticleAction : createArticleAction;
  const [state, action, pending] = useActionState(actionFn, initial);

  return (
    <div style={{ maxWidth: "800px" }}>
      <form action={action}>
        {isEdit ? (
          <input type="hidden" name="articleId" value={article.id} />
        ) : null}

        {state.error ? (
          <p className="notice notice-error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.notice ? (
          <p className="notice notice-ok" role="status">
            {state.notice}
          </p>
        ) : null}

        <div style={{ marginBottom: "16px" }}>
          <label className="label" htmlFor="article-title">
            Title
          </label>
          <input
            id="article-title"
            name="title"
            required
            maxLength={200}
            defaultValue={article?.title ?? ""}
            placeholder="e.g. How to reset your password"
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div>
            <label className="label" htmlFor="article-category">
              Category
            </label>
            <select
              id="article-category"
              name="categoryId"
              defaultValue={article?.category_id ?? ""}
            >
              <option value="">No category (Uncategorized)</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="article-status">
              Status
            </label>
            <select
              id="article-status"
              name="status"
              defaultValue={article?.status ?? "draft"}
            >
              <option value="draft">Draft (Internal only)</option>
              <option value="published">Published (Visible on Help Center)</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="article-slug">
              Custom URL Slug <span className="muted">(optional)</span>
            </label>
            <input
              id="article-slug"
              name="slug"
              defaultValue={article?.slug ?? ""}
              placeholder="auto-generated from title"
            />
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label className="label" htmlFor="article-body">
            Article Content
          </label>
          <textarea
            id="article-body"
            name="body"
            required
            rows={16}
            defaultValue={article?.body ?? ""}
            placeholder="Write article content here. Paragraphs and line breaks are preserved..."
            style={{ fontFamily: "inherit", lineHeight: "1.6" }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={pending}
            >
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create article"}
            </button>
            <Link className="btn btn-secondary" href="/articles">
              Cancel
            </Link>
          </div>

          {isEdit && article.status === "published" ? (
            <a
              className="btn btn-secondary"
              href={`/o/${portalSlug}/kb/${article.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Help Center ↗
            </a>
          ) : null}
        </div>
      </form>

      {isEdit ? (
        <div
          style={{
            marginTop: "40px",
            paddingTop: "20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: "var(--red)" }}>
              Danger Zone
            </div>
            <div className="hint">
              Permanently delete this article and remove it from search.
            </div>
          </div>
          <form action={deleteArticleAction}>
            <input type="hidden" name="articleId" value={article.id} />
            <button
              className="btn btn-secondary"
              style={{ color: "var(--red)", borderColor: "var(--red-soft)" }}
              type="submit"
              onClick={(e) => {
                if (
                  !confirm(
                    `Are you sure you want to delete "${article.title}"? This cannot be undone.`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              Delete article
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
