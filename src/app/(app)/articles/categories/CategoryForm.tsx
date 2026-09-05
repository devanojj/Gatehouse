"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createCategoryAction,
  type CategoryFormState,
} from "@/app/actions/kb-categories";

const initial: CategoryFormState = {};

export function CategoryForm() {
  const [state, action, pending] = useActionState(createCategoryAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && state.notice) formRef.current?.reset();
  }, [state, pending]);

  return (
    <form ref={formRef} action={action}>
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

      <div style={{ marginBottom: "12px" }}>
        <label className="label" htmlFor="cat-name">
          Category name
        </label>
        <input
          id="cat-name"
          name="name"
          required
          maxLength={60}
          placeholder="e.g. Getting Started"
        />
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="label" htmlFor="cat-desc">
          Description <span className="muted">(optional)</span>
        </label>
        <input
          id="cat-desc"
          name="description"
          maxLength={250}
          placeholder="e.g. Guides for setting up and using your account"
        />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label className="label" htmlFor="cat-pos">
          Display order
        </label>
        <input
          id="cat-pos"
          name="position"
          type="number"
          defaultValue={0}
          style={{ width: "100px" }}
        />
        <p className="hint">Lower numbers appear first on the portal.</p>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add category"}
        </button>
      </div>
    </form>
  );
}
