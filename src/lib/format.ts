/** SQLite gives us `YYYY-MM-DD HH:MM:SS` in UTC. */
function parseSqlDate(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

export function formatDate(value: string): string {
  return parseSqlDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string): string {
  return parseSqlDate(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const STATUS_LABELS: Record<string, string> = {
  "open": "Open",
  "pending": "Waiting on customer",
  "in-progress": "In progress",
  "resolved": "Resolved",
  "closed": "Closed",
};

/** The short form, for a tab or a table cell where the full label is too wide. */
export const STATUS_SHORT_LABELS: Record<string, string> = {
  "open": "Open",
  "pending": "Waiting",
  "in-progress": "In progress",
  "resolved": "Resolved",
  "closed": "Closed",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
