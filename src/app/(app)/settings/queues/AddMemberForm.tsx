"use client";

import { useActionState } from "react";

import {
  addQueueMemberAction,
  type QueueFormState,
} from "@/app/actions/queues";

const initial: QueueFormState = {};

export function AddMemberForm({
  queueId,
  candidates,
}: {
  queueId: number;
  candidates: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    addQueueMemberAction,
    initial,
  );

  if (candidates.length === 0) {
    return <p className="hint">Everyone on the team is already in this queue.</p>;
  }

  return (
    <form action={action}>
      <input type="hidden" name="queueId" value={queueId} />

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="inline-form">
        <div className="field">
          <label className="label" htmlFor={`add-member-${queueId}`}>
            Add a teammate
          </label>
          <select id={`add-member-${queueId}`} name="agentId" defaultValue="">
            <option value="" disabled>
              Choose someone…
            </option>
            {candidates.map((agent) => (
              <option key={agent.id} value={String(agent.id)}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
