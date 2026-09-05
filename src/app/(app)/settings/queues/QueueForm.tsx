"use client";

import { useActionState, useEffect, useRef } from "react";

import { createQueueAction, type QueueFormState } from "@/app/actions/queues";

const initial: QueueFormState = {};

export function QueueForm() {
  const [state, action, pending] = useActionState(createQueueAction, initial);
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

      <label className="label" htmlFor="queue-name">
        Queue name
      </label>
      <input
        id="queue-name"
        name="name"
        required
        maxLength={60}
        placeholder="Billing"
      />
      <p className="hint">
        Agents route tickets here by hand. Rules that route them automatically
        come later.
      </p>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create queue"}
        </button>
      </div>
    </form>
  );
}
