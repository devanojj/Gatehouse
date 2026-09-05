import Link from "next/link";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  countUnreadNotifications,
  listNotifications,
  type NotificationType,
} from "@/lib/notifications";

function typeBadge(type: NotificationType) {
  switch (type) {
    case "ticket_assigned":
      return <span className="badge badge-blue">Assigned</span>;
    case "customer_reply":
      return <span className="badge badge-violet">Reply</span>;
    case "sla_breached":
      return <span className="badge badge-red">SLA Breach</span>;
    case "sla_warning":
      return <span className="badge badge-amber">SLA Warning</span>;
    default:
      return <span className="badge badge-gray">{type}</span>;
  }
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const unreadOnly = params.unread === "1";

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(session.orgId, session.agentId, { unreadOnly }),
    countUnreadNotifications(session.orgId, session.agentId),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Updates on ticket assignments, customer replies, and SLA alerts.</p>
        </div>

        {unreadCount > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button className="btn btn-secondary btn-sm" type="submit">
              Mark all as read
            </button>
          </form>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "16px",
          alignItems: "center",
        }}
      >
        <Link
          href="/notifications"
          className={`btn btn-sm ${!unreadOnly ? "btn-primary" : "btn-secondary"}`}
        >
          All
        </Link>
        <Link
          href="/notifications?unread=1"
          className={`btn btn-sm ${unreadOnly ? "btn-primary" : "btn-secondary"}`}
        >
          Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
        </Link>
      </div>

      <div className="card">
        {notifications.length === 0 ? (
          <div
            className="muted"
            style={{ textAlign: "center", padding: "40px 16px" }}
          >
            {unreadOnly
              ? "You have no unread notifications."
              : "No notifications yet."}
          </div>
        ) : (
          <ul className="notification-list">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`notification-item ${!n.read_at ? "notification-unread" : ""}`}
              >
                <div className="notification-meta">
                  <span style={{ marginRight: "8px" }}>{typeBadge(n.type)}</span>
                  <span className="muted" style={{ fontSize: "12px" }}>
                    {formatDateTime(n.created_at)}
                  </span>
                </div>

                <div className="notification-content">
                  <div className="notification-title">{n.title}</div>
                  <div className="notification-body">{n.body}</div>
                  {n.ticket_id ? (
                    <div style={{ marginTop: "6px" }}>
                      <Link
                        href={`/tickets/${n.ticket_id}`}
                        style={{ fontSize: "13px", fontWeight: 500 }}
                      >
                        Open ticket #{n.ticket_id} →
                      </Link>
                    </div>
                  ) : null}
                </div>

                {!n.read_at ? (
                  <div className="notification-action">
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button className="btn-link" type="submit" title="Mark as read">
                        Mark read
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
