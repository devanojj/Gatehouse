"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addCommentAction, type TicketFormState } from "@/app/actions/tickets";

const initial: TicketFormState = {};

export function Composer({ ticketId }: { ticketId: number }) {
  const [state, action, pending] = useActionState(addCommentAction, initial);
  const [type, setType] = useState<"public" | "internal">("public");
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the textarea once a post lands (no error came back).
  useEffect(() => {
    if (!pending && state && !state.error) formRef.current?.reset();
  }, [state, pending]);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="ticketId" value={ticketId} />

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="composer-toggle">
        <label className="composer-choice">
          <input
            type="radio"
            name="type"
            value="public"
            checked={type === "public"}
            onChange={() => setType("public")}
          />
          <span>Reply to client</span>
        </label>
        <label className="composer-choice is-internal">
          <input
            type="radio"
            name="type"
            value="internal"
            checked={type === "internal"}
            onChange={() => setType("internal")}
          />
          <span>Internal note</span>
        </label>
      </div>

      <textarea
        name="body"
        rows={4}
        required
        aria-label={type === "public" ? "Reply to client" : "Internal note"}
        placeholder={
          type === "public"
            ? "This reply is meant for the person who reported the ticket."
            : "Only your teammates will see this."
        }
      />

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending
            ? "Posting…"
            : type === "public"
              ? "Send reply"
              : "Add internal note"}
        </button>
      </div>
    </form>
  );
}
