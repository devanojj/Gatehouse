"use client";

import { useActionState } from "react";

import { submitRequestAction, type PortalFormState } from "@/app/actions/portal";

const initial: PortalFormState = {};

export function NewRequestForm({
  orgSlug,
  knownEmail,
  knownName,
}: {
  orgSlug: string;
  knownEmail?: string;
  knownName?: string;
}) {
  const [state, action, pending] = useActionState(submitRequestAction, initial);

  return (
    <form action={action}>
      <input type="hidden" name="orgSlug" value={orgSlug} />

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <label className="label" htmlFor="name">
        Your name
      </label>
      <input id="name" name="name" required defaultValue={knownName ?? ""} />

      <label className="label" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        defaultValue={knownEmail ?? ""}
      />
      <p className="hint">We will reply here, and you can use it to check back.</p>

      <label className="label" htmlFor="subject">
        What is it about?
      </label>
      <input
        id="subject"
        name="subject"
        required
        maxLength={120}
        placeholder="Card declined at checkout"
      />

      <label className="label" htmlFor="description">
        What happened?
      </label>
      <textarea
        id="description"
        name="description"
        rows={6}
        required
        placeholder="What you expected, what happened instead, and anything you have already tried."
      />

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}
