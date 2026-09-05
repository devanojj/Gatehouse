"use client";

import { useActionState, useState } from "react";

import {
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/actions/kb-categories";
import type { KbCategoryWithCount } from "@/lib/kb-categories";

export function CategoryRow({ category }: { category: KbCategoryWithCount }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateCategoryAction, {});

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <form
            action={async (formData) => {
              await action(formData);
              setEditing(false);
            }}
            style={{ padding: "8px 0" }}
          >
            <input type="hidden" name="categoryId" value={category.id} />
            {state.error ? (
              <p className="notice notice-error" role="alert">
                {state.error}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: "1 1 180px" }}>
                <label className="label">Name</label>
                <input
                  name="name"
                  defaultValue={category.name}
                  required
                  maxLength={60}
                />
              </div>
              <div style={{ flex: "2 1 240px" }}>
                <label className="label">Description</label>
                <input
                  name="description"
                  defaultValue={category.description ?? ""}
                  maxLength={250}
                />
              </div>
              <div style={{ width: "80px" }}>
                <label className="label">Order</label>
                <input
                  name="position"
                  type="number"
                  defaultValue={category.position}
                />
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "24px" }}>
                <button
                  className="btn btn-primary btn-sm"
                  type="submit"
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{category.name}</strong>
        {category.description ? (
          <div className="hint">{category.description}</div>
        ) : null}
      </td>
      <td className="muted nowrap">
        <code>{category.slug}</code>
      </td>
      <td className="num">{category.position}</td>
      <td className="num">{category.article_count}</td>
      <td>
        <div className="row-actions">
          <button
            className="btn-link"
            type="button"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <form action={deleteCategoryAction}>
            <input type="hidden" name="categoryId" value={category.id} />
            <button
              className="btn-link btn-link-danger"
              type="submit"
              onClick={(e) => {
                if (
                  !confirm(
                    `Delete category "${category.name}"? Articles in this category will become uncategorized.`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              Delete
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}
