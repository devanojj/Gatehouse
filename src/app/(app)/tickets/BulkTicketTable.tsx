"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { bulkUpdateTicketsAction } from "@/app/actions/tickets";
import { formatDate } from "@/lib/format";
import { PriorityBadge, StatusBadge } from "@/app/ui/Badge";
import type { TicketRowView } from "@/lib/tickets";

/**
 * Plain props only — the narrowed row view, and just the id and name of each
 * queue and agent needed to fill the bulk-action selects. Nothing here is a
 * database row.
 */
type Option = { id: number; name: string };

type Props = {
  tickets: TicketRowView[];
  queues: Option[];
  agents: Option[];
  currentAgentId: number;
  userRole: "owner" | "member";
};

export function BulkTicketTable({
  tickets,
  queues,
  agents,
  userRole,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected =
    tickets.length > 0 && tickets.every((t) => selectedIds.has(t.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map((t) => t.id)));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleAction(formData: FormData) {
    for (const id of selectedIds) {
      formData.append("ticketId", String(id));
    }
    startTransition(async () => {
      await bulkUpdateTicketsAction(formData);
      setSelectedIds(new Set());
    });
  }

  return (
    <div className="table-wrap">
      {selectedIds.size > 0 ? (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <div className="bulk-bar-info">
            <strong>{selectedIds.size}</strong>{" "}
            {selectedIds.size === 1 ? "ticket" : "tickets"} selected
            {isPending ? <span className="bulk-bar-pending">Updating…</span> : null}
          </div>

          <div className="bulk-bar-actions">
            {/* Bulk Status */}
            <form action={handleAction} className="bulk-form">
              <input type="hidden" name="action" value="status" />
              <select name="status" defaultValue="open" aria-label="Status">
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="pending_customer">Waiting on client</option>
                <option value="resolved">Resolved</option>
                {userRole === "owner" ? <option value="closed">Closed</option> : null}
              </select>
              <button className="btn btn-secondary btn-sm" type="submit" disabled={isPending}>
                Update status
              </button>
            </form>

            {/* Bulk Assignee */}
            <form action={handleAction} className="bulk-form">
              <input type="hidden" name="action" value="assignee" />
              <select name="assignedAgentId" defaultValue="" aria-label="Assignee">
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={String(agent.id)}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary btn-sm" type="submit" disabled={isPending}>
                Assign
              </button>
            </form>

            {/* Bulk Queue */}
            {queues.length > 1 ? (
              <form action={handleAction} className="bulk-form">
                <input type="hidden" name="action" value="queue" />
                <select name="queueId" defaultValue={queues[0]?.id} aria-label="Queue">
                  {queues.map((queue) => (
                    <option key={queue.id} value={String(queue.id)}>
                      {queue.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-secondary btn-sm" type="submit" disabled={isPending}>
                  Move queue
                </button>
              </form>
            ) : null}

            {/* Bulk Priority */}
            <form action={handleAction} className="bulk-form">
              <input type="hidden" name="action" value="priority" />
              <select name="priority" defaultValue="medium" aria-label="Priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button className="btn btn-secondary btn-sm" type="submit" disabled={isPending}>
                Set priority
              </button>
            </form>

            <button
              type="button"
              className="btn-link btn-sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Deselect
            </button>
          </div>
        </div>
      ) : null}

      <table>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="Select all tickets"
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
            <th>#</th>
            <th>Subject</th>
            <th>Queue</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const isSelected = selectedIds.has(ticket.id);
            return (
              <tr key={ticket.id} className={isSelected ? "row-selected" : undefined}>
                <td className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ticket #${ticket.id}`}
                    checked={isSelected}
                    onChange={() => toggleOne(ticket.id)}
                  />
                </td>
                <td className="num">{ticket.id}</td>
                <td className="subject">
                  <Link href={`/tickets/${ticket.id}`}>{ticket.subject}</Link>
                </td>
                <td className="muted nowrap">{ticket.queue_name ?? "—"}</td>
                <td>
                  <StatusBadge status={ticket.status} />
                </td>
                <td>
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="muted nowrap">
                  {ticket.assigned_agent_name ?? "Unassigned"}
                </td>
                <td className="muted nowrap">{formatDate(ticket.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
