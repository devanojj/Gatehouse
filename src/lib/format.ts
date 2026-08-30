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
  "in-progress": "In progress",
  "closed": "Closed",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
