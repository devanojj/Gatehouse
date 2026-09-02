import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";
import type { Priority, Status } from "@/lib/tickets";

const STATUS_TONE: Record<Status, string> = {
  "open": "badge-amber",
  // Waiting on the customer: nothing for us to do, but not finished either.
  "pending": "badge-violet",
  "in-progress": "badge-blue",
  // An answer given and holding, until the customer accepts it or writes back.
  "resolved": "badge-teal",
  "closed": "badge-gray",
};

const PRIORITY_TONE: Record<Priority, string> = {
  low: "badge-gray",
  medium: "badge-blue",
  high: "badge-red",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${STATUS_TONE[status] ?? "badge-gray"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge ${PRIORITY_TONE[priority] ?? "badge-gray"}`}>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}
