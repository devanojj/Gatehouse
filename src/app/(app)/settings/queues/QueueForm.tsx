"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createQueueAction,
  renameQueueAction,
  type QueueFormState,
} from "@/app/actions/queues";

const initial: QueueFormState = {};

/**
 * One form for both jobs: with a `queue` it renames that queue, without one it
 * creates a new one. Only plain props cross the boundary — the id is echoed
 * back to the action, which re-resolves it inside the caller's organization.
 */
export function QueueForm({
  queue,
}: {
  queue?: { id: number; name: string; description: string | null };
}) {
  const [state, action, pending] = useActionState(
    queue ? renameQueueAction : createQueueAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!queue && state.saved) formRef.current?.reset();
  }, [queue, state.saved]);

  return (
    <form ref={formRef} action={action}>
      {queue ? <input type="hidden" name="queueId" value={queue.id} /> : null}

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p className="notice notice-ok" role="status">
          {state.saved}
        </p>
      ) : null}

      <div className="inline-form">
        <div className="field">
          <label className="label" htmlFor={`queue-name-${queue?.id ?? "new"}`}>
            Name
          </label>
          <input
            id={`queue-name-${queue?.id ?? "new"}`}
            name="name"
            type="text"
            required
            defaultValue={queue?.name ?? ""}
            placeholder="Billing"
          />
        </div>

        <div className="field">
          <label
            className="label"
            htmlFor={`queue-description-${queue?.id ?? "new"}`}
          >
            Description <span className="label-optional">optional</span>
          </label>
          <input
            id={`queue-description-${queue?.id ?? "new"}`}
            name="description"
            type="text"
            defaultValue={queue?.description ?? ""}
            placeholder="Invoices, refunds and renewals"
          />
        </div>

        <div className="form-actions">
          <button
            className={queue ? "btn btn-secondary" : "btn btn-primary"}
            type="submit"
            disabled={pending}
          >
            {pending ? "Saving…" : queue ? "Save" : "Create queue"}
          </button>
        </div>
      </div>
    </form>
  );
}
