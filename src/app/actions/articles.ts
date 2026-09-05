"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  createArticle,
  deleteArticle,
  getArticle,
  isArticleStatus,
  updateArticle,
} from "@/lib/articles";
import { getCategory } from "@/lib/kb-categories";

export type ArticleFormState = {
  error?: string;
  notice?: string;
};

const MAX_TITLE = 200;

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function requireArticle(formData: FormData) {
  const session = await requireSession();
  const articleId = Number(formData.get("articleId"));

  if (!Number.isInteger(articleId) || articleId <= 0) {
    throw new Error("Invalid article.");
  }

  const article = await getArticle(session.orgId, articleId);
  if (!article) throw new Error("Article not found.");

  return { session, article };
}

export async function createArticleAction(
  _prev: ArticleFormState | undefined,
  formData: FormData,
): Promise<ArticleFormState> {
  const session = await requireSession();
  const title = readString(formData, "title");
  const slug = readString(formData, "slug") || undefined;
  const body = readString(formData, "body");
  const rawStatus = formData.get("status");
  const status = isArticleStatus(rawStatus) ? rawStatus : "draft";

  const rawCatId = formData.get("categoryId");
  let categoryId: number | null = null;
  if (rawCatId && rawCatId !== "") {
    const num = Number(rawCatId);
    if (Number.isInteger(num) && num > 0) {
      const cat = await getCategory(session.orgId, num);
      if (cat) categoryId = cat.id;
    }
  }

  if (!title) return { error: "Give the article a title." };
  if (title.length > MAX_TITLE) {
    return { error: `Keep the title under ${MAX_TITLE} characters.` };
  }
  if (!body) return { error: "Article content cannot be empty." };

  const id = await createArticle(session.orgId, {
    title,
    slug,
    body,
    status,
    categoryId,
    authorAgentId: session.agentId,
  });

  revalidatePath("/articles");
  redirect(`/articles/${id}`);
}

export async function updateArticleAction(
  _prev: ArticleFormState | undefined,
  formData: FormData,
): Promise<ArticleFormState> {
  const { session, article } = await requireArticle(formData);
  const title = readString(formData, "title");
  const slug = readString(formData, "slug") || undefined;
  const body = readString(formData, "body");
  const rawStatus = formData.get("status");
  const status = isArticleStatus(rawStatus) ? rawStatus : article.status;

  const rawCatId = formData.get("categoryId");
  let categoryId: number | null = null;
  if (rawCatId && rawCatId !== "") {
    const num = Number(rawCatId);
    if (Number.isInteger(num) && num > 0) {
      const cat = await getCategory(session.orgId, num);
      if (cat) categoryId = cat.id;
    }
  }

  if (!title) return { error: "A title is required." };
  if (title.length > MAX_TITLE) {
    return { error: `Keep the title under ${MAX_TITLE} characters.` };
  }
  if (!body) return { error: "Article content cannot be empty." };

  await updateArticle(session.orgId, article.id, {
    title,
    slug,
    body,
    status,
    categoryId,
  });

  revalidatePath("/articles");
  revalidatePath(`/articles/${article.id}`);
  return { notice: "Article saved successfully." };
}

export async function deleteArticleAction(formData: FormData): Promise<void> {
  const { session, article } = await requireArticle(formData);

  await deleteArticle(session.orgId, article.id);

  revalidatePath("/articles");
  redirect("/articles");
}
