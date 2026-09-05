"use client";

import { useRef, useState, useTransition } from "react";

import { createSavedViewAction } from "@/app/actions/views";

export function SaveViewForm({ filtersQuery }: { filtersQuery: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await createSavedViewAction(formData);
      setName("");
      setOpen(false);
    });
  }

  return (
    <div className="save-view-wrap">
      {!open ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setOpen(true)}
        >
          Save view…
        </button>
      ) : (
        <form
          ref={formRef}
          action={handleSubmit}
          className="save-view-form"
        >
          <input type="hidden" name="filters" value={filtersQuery} />
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name (e.g. High Priority Billing)"
            required
            autoFocus
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={isPending || !name.trim()}
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn-link btn-sm"
            onClick={() => {
              setOpen(false);
              setName("");
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
