"use client";

import { useRef, useTransition } from "react";

/**
 * A one-field form that submits as soon as the value changes, so status,
 * priority, and assignee can be changed straight from the ticket without a
 * save button. Degrades to a visible submit button without JavaScript.
 */
export function InlineSelect({
  action,
  label,
  name,
  ticketId,
  value,
  options,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  name: string;
  ticketId: number;
  value: string;
  options: { value: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="ticketId" value={ticketId} />

      <label className="label" htmlFor={`${name}-${ticketId}`}>
        {label}
      </label>
      <select
        // Remount when the server value changes, so the control re-syncs
        // after a revalidation instead of holding its stale DOM value.
        key={value}
        id={`${name}-${ticketId}`}
        name={name}
        defaultValue={value}
        disabled={pending}
        onChange={(event) => {
          const form = event.currentTarget.form;
          if (form) startTransition(() => form.requestSubmit());
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <noscript>
        <button className="btn btn-secondary" type="submit" style={{ marginTop: 8 }}>
          Update {label.toLowerCase()}
        </button>
      </noscript>
    </form>
  );
}
