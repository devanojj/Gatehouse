"use client";

import { useActionState } from "react";

import { signup, type AuthFormState } from "@/app/actions/auth";

const initial: AuthFormState = {};

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, initial);

  if (state.sentTo) {
    return (
      <>
        <h1>Check your inbox</h1>
        <p className="auth-lede">
          Your workspace is ready. We sent a sign-in link to{" "}
          <strong>{state.sentTo}</strong> — open it to finish setting up.
        </p>
        <p className="hint">
          No email provider configured yet? The link is printed in your server
          console.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Create your workspace</h1>
      <p className="auth-lede">
        Your organization gets its own tickets, team, and data.
      </p>

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <form action={action}>
        <div className="field">
          <label htmlFor="orgName">Organization name</label>
          <input
            id="orgName"
            name="orgName"
            type="text"
            required
            autoComplete="organization"
            placeholder="Northwind Support"
          />
        </div>

        <div className="field">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Alex Rivera"
          />
        </div>

        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="alex@northwind.com"
          />
          <p className="hint">We&rsquo;ll email you a link to sign in — no password.</p>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </button>
        </div>
      </form>
    </>
  );
}
