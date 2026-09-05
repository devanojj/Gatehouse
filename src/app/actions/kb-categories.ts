"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  createCategory,
  deleteCategory,
  getCategory,
  updateCategory,
} from "@/lib/kb-categories";

export type CategoryFormState = {
  error?: string;
  notice?: string;
};

const MAX_NAME = 60;
const MAX_DESCRIPTION = 250;

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function requireCategory(formData: FormData) {
  const session = await requireSession();
  const categoryId = Number(formData.get("categoryId"));

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error("Invalid category.");
  }

  const category = await getCategory(session.orgId, categoryId);
  if (!category) throw new Error("Category not found.");

  return { session, category };
}

export async function createCategoryAction(
  _prev: CategoryFormState | undefined,
  formData: FormData,
): Promise<CategoryFormState> {
  const session = await requireSession();
  const name = readString(formData, "name");
  const slug = readString(formData, "slug") || undefined;
  const description = readString(formData, "description") || null;
  const position = Number(formData.get("position")) || 0;

  if (!name) return { error: "Give the category a name." };
  if (name.length > MAX_NAME) {
    return { error: `Keep the name under ${MAX_NAME} characters.` };
  }
  if (description && description.length > MAX_DESCRIPTION) {
    return { error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  }

  await createCategory(session.orgId, {
    name,
    slug,
    description,
    position,
  });

  revalidatePath("/articles");
  revalidatePath("/articles/categories");
  return { notice: `Category "${name}" created.` };
}

export async function updateCategoryAction(
  _prev: CategoryFormState | undefined,
  formData: FormData,
): Promise<CategoryFormState> {
  const { session, category } = await requireCategory(formData);
  const name = readString(formData, "name");
  const slug = readString(formData, "slug") || undefined;
  const description = readString(formData, "description") || null;
  const position = Number(formData.get("position")) || 0;

  if (!name) return { error: "A category needs a name." };
  if (name.length > MAX_NAME) {
    return { error: `Keep the name under ${MAX_NAME} characters.` };
  }
  if (description && description.length > MAX_DESCRIPTION) {
    return { error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  }

  await updateCategory(session.orgId, category.id, {
    name,
    slug,
    description,
    position,
  });

  revalidatePath("/articles");
  revalidatePath("/articles/categories");
  return { notice: `Category "${name}" updated.` };
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const { session, category } = await requireCategory(formData);

  await deleteCategory(session.orgId, category.id);

  revalidatePath("/articles");
  revalidatePath("/articles/categories");
}
