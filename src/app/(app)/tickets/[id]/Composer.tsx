"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addCommentAction, type TicketFormState } from "@/app/actions/tickets";

const initial: TicketFormState = {};

/** A macro whose placeholders have already been filled in on the server. */
export type ComposerMacro = { id: number; name: string; body: string };

export function Composer({
  ticketId,
  macros,
  accept,
  maxFiles,
  maxFileSize,
}: {
  ticketId: number;
  macros: ComposerMacro[];
  accept: string;
  maxFiles: number;
  maxFileSize: string;
}) {
  const [state, action, pending] = useActionState(addCommentAction, initial);
  const [type, setType] = useState<"public" | "internal">("public");
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Clear the composer once a post lands (no error came back). The textarea is
  // uncontrolled, so the form's own reset is all it takes.
  useEffect(() => {
    if (!pending && state && !state.error) formRef.current?.reset();
  }, [state, pending]);

  function insertMacro(macroId: string) {
    const macro = macros.find((candidate) => String(candidate.id) === macroId);
    const textarea = bodyRef.current;
    if (!macro || !textarea) return;

    // Appended rather than substituted, so a half-written reply survives.
    const current = textarea.value.trimEnd();
    textarea.value = current ? `${current}\n\n${macro.body}` : macro.body;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="ticketId" value={ticketId} />

      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.warning ? (
        <p className="notice notice-warn" role="status">
          {state.warning}
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

      {macros.length > 0 ? (
        <div className="composer-tools">
          <div className="field">
            <label className="label" htmlFor={`macro-${ticketId}`}>
              Insert a saved reply
            </label>
            <select
              id={`macro-${ticketId}`}
              value=""
              onChange={(event) => insertMacro(event.currentTarget.value)}
            >
              <option value="">Choose a macro…</option>
              {macros.map((macro) => (
                <option key={macro.id} value={String(macro.id)}>
                  {macro.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <textarea
        ref={bodyRef}
        name="body"
        rows={4}
        aria-label={type === "public" ? "Reply to client" : "Internal note"}
        placeholder={
          type === "public"
            ? "This reply is meant for the person who reported the ticket."
            : "Only your teammates will see this."
        }
      />

      <div className="field file-field">
        <label htmlFor={`attachments-${ticketId}`}>Attach files</label>
        <input
          id={`attachments-${ticketId}`}
          type="file"
          name="attachments"
          multiple
          accept={accept}
        />
        <p className="hint">
          Up to {maxFiles} files, {maxFileSize} each. Files stay on the ticket —
          they are not sent with the email.
        </p>
      </div>

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
