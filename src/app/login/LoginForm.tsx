"use client";

import { useActionState } from "react";

import { login, type AuthFormState } from "@/app/actions/auth";

const initial: AuthFormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  if (state.sentTo) {
    return (
      <>
        <h1>Check your inbox</h1>
        <p className="auth-lede">
          We sent a sign-in link to <strong>{state.sentTo}</strong>. It expires
          in 30 minutes.
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
      <h1>Sign in</h1>
      <p className="auth-lede">
        We&rsquo;ll email you a link — there&rsquo;s no password to remember.
      </p>

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <form action={action}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Email me a link"}
          </button>
        </div>
      </form>
    </>
  );
}
