"use client";

import Link from "next/link";
import { useActionState } from "react";

import { checkInboundMailAction, type InboxCheckState } from "@/app/actions/inbox";

const initial: InboxCheckState = {};

export function CheckMailButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState(
    checkInboundMailAction,
    initial,
  );

  return (
    <form action={action}>
      {state.error ? (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.summary ? (
        <p
          className={`notice ${state.summary.failed > 0 ? "notice-warn" : "notice-ok"}`}
          role="status"
        >
          {describe(state.summary)}
        </p>
      ) : null}

      <div className="form-actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || disabled}
        >
          {pending ? "Checking…" : "Check for new mail"}
        </button>
        {state.summary && state.summary.created + state.summary.appended > 0 ? (
          <Link className="btn btn-secondary" href="/tickets">
            View tickets
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function describe(summary: InboxCheckState["summary"]): string {
  if (!summary) return "";

  if (summary.matched === 0) {
    return "No new mail for this workspace.";
  }

  const parts: string[] = [];
  if (summary.created > 0) parts.push(plural(summary.created, "new ticket"));
  if (summary.appended > 0) {
    parts.push(`${plural(summary.appended, "reply", "replies")} added to existing tickets`);
  }
  if (summary.duplicates > 0) {
    parts.push(`${plural(summary.duplicates, "message")} already filed`);
  }
  if (summary.failed > 0) {
    parts.push(`${plural(summary.failed, "message")} could not be filed and will be retried`);
  }

  return `${plural(summary.matched, "message")} collected — ${parts.join(", ")}.`;
}

function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
