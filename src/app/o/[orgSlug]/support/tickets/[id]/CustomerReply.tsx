"use client";

import { useActionState, useEffect, useRef } from "react";

import { customerReplyAction, type PortalFormState } from "@/app/actions/portal";

const initial: PortalFormState = {};

export function CustomerReply({ ticketId }: { ticketId: number }) {
  const [state, action, pending] = useActionState(customerReplyAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

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

      <label className="label" htmlFor="body">
        Add to this request
      </label>
      <textarea
        id="body"
        name="body"
        rows={4}
        required
        placeholder="Anything else that would help us sort this out."
      />

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
