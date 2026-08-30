"use client";

import { useActionState, useEffect, useRef } from "react";

import { inviteAgent, type InviteFormState } from "@/app/actions/team";

const initial: InviteFormState = {};

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAgent, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.invited) formRef.current?.reset();
  }, [state.invited]);

  return (
    <form ref={formRef} action={action}>
      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.invited ? (
        <p className="notice notice-ok" role="status">
          Invited {state.invited}. They&rsquo;ll get a sign-in link by email.
        </p>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="invite-name">Name</label>
          <input
            id="invite-name"
            name="name"
            type="text"
            required
            placeholder="Sam Okafor"
          />
        </div>

        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="sam@company.com"
          />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}
