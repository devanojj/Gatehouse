"use client";

import { useActionState } from "react";

import {
  updateSupportEmailAction,
  type SupportEmailState,
} from "@/app/actions/inbox";

const initial: SupportEmailState = {};

export function SupportEmailForm({
  supportEmail,
}: {
  supportEmail: string | null;
}) {
  const [state, action, pending] = useActionState(
    updateSupportEmailAction,
    initial,
  );

  return (
    <form action={action}>
      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p className="notice notice-ok" role="status">
          Support address saved.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="supportEmail">Support address</label>
        <input
          id="supportEmail"
          name="supportEmail"
          type="email"
          defaultValue={supportEmail ?? ""}
          placeholder="support@northwind.com"
        />
        <p className="hint">Leave blank if you don&rsquo;t have one yet.</p>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
