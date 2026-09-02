"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createTicketAction, type TicketFormState } from "@/app/actions/tickets";

const initial: TicketFormState = {};

export function NewTicketForm({
  queues,
}: {
  queues: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(createTicketAction, initial);

  return (
    <form action={action}>
      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="subject">Subject</label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          placeholder="Laptop won't connect to the VPN"
        />
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="requesterEmail">Requester email</label>
          <input
            id="requesterEmail"
            name="requesterEmail"
            type="email"
            placeholder="person@company.com"
          />
          <p className="hint">Who reported it. Optional.</p>
        </div>

        <div className="field">
          <label htmlFor="priority">Priority</label>
          <select id="priority" name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      {queues.length > 0 ? (
        <div className="field">
          <label htmlFor="queueId">Queue</label>
          <select id="queueId" name="queueId" defaultValue="">
            <option value="">No queue</option>
            {queues.map((queue) => (
              <option key={queue.id} value={String(queue.id)}>
                {queue.name}
              </option>
            ))}
          </select>
          <p className="hint">Which team should pick this up. Optional.</p>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          rows={7}
          placeholder="What happened, what was expected, anything already tried."
        />
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create ticket"}
        </button>
        <Link className="btn btn-secondary" href="/tickets">
          Cancel
        </Link>
      </div>
    </form>
  );
}
