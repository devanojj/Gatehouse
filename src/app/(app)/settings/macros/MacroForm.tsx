"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createMacroAction,
  updateMacroAction,
  type MacroFormState,
} from "@/app/actions/macros";

const initial: MacroFormState = {};

/**
 * Create when there is no `macro`, edit when there is. The body is plain text;
 * placeholders are filled in on the server when the macro is inserted into a
 * reply, so nothing here needs to know about a ticket.
 */
export function MacroForm({
  macro,
}: {
  macro?: { id: number; name: string; body: string };
}) {
  const [state, action, pending] = useActionState(
    macro ? updateMacroAction : createMacroAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!macro && state.saved) formRef.current?.reset();
  }, [macro, state.saved]);

  return (
    <form ref={formRef} action={action}>
      {macro ? <input type="hidden" name="macroId" value={macro.id} /> : null}

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

      <div className="field">
        <label htmlFor={`macro-name-${macro?.id ?? "new"}`}>Name</label>
        <input
          id={`macro-name-${macro?.id ?? "new"}`}
          name="name"
          type="text"
          required
          defaultValue={macro?.name ?? ""}
          placeholder="Asking for a screenshot"
        />
      </div>

      <div className="field">
        <label htmlFor={`macro-body-${macro?.id ?? "new"}`}>Reply</label>
        <textarea
          id={`macro-body-${macro?.id ?? "new"}`}
          name="body"
          rows={6}
          required
          defaultValue={macro?.body ?? ""}
          placeholder={
            "Hi {{requester_name}},\n\nCould you send a screenshot of the error?\n\nThanks,\n{{agent_name}}"
          }
        />
      </div>

      <div className="form-actions">
        <button
          className={macro ? "btn btn-secondary" : "btn btn-primary"}
          type="submit"
          disabled={pending}
        >
          {pending ? "Saving…" : macro ? "Save" : "Create macro"}
        </button>
      </div>
    </form>
  );
}
