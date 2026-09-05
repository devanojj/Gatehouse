"use client";

import { useActionState } from "react";

import { renameQueueAction, type QueueFormState } from "@/app/actions/queues";

const initial: QueueFormState = {};

/**
 * One row's rename control. Kept as its own form so a failed rename reports
 * against the queue it belongs to rather than at the top of the page.
 */
export function RenameForm({
  queueId,
  name,
}: {
  queueId: number;
  name: string;
}) {
  const [state, action, pending] = useActionState(renameQueueAction, initial);

  return (
    <form action={action} className="rename-form">
      <input type="hidden" name="queueId" value={queueId} />

      <label className="visually-hidden" htmlFor={`queue-${queueId}`}>
        Name for {name}
      </label>
      <input
        id={`queue-${queueId}`}
        name="name"
        defaultValue={name}
        required
        maxLength={60}
        disabled={pending}
      />
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        Save
      </button>

      {state.error ? (
        <span className="field-error" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
