"use client";

import { useActionState } from "react";

import {
  requestCustomerLinkAction,
  type PortalFormState,
} from "@/app/actions/portal";

const initial: PortalFormState = {};

export function CustomerLoginForm({ orgSlug }: { orgSlug: string }) {
  const [state, action, pending] = useActionState(
    requestCustomerLinkAction,
    initial,
  );

  return (
    <form action={action}>
      <input type="hidden" name="orgSlug" value={orgSlug} />

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

      <label className="label" htmlFor="email">
        Email
      </label>
      <input id="email" name="email" type="email" required />
      <p className="hint">
        Use the address you raised your request with. We will send a link — no
        password to remember.
      </p>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </div>
    </form>
  );
}
