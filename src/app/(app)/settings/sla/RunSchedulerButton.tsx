"use client";

import { useState } from "react";

import { runSchedulerAction } from "@/app/actions/sla";
import type { SchedulerResult } from "@/lib/scheduler";

export function RunSchedulerButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SchedulerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await runSchedulerAction();
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run scheduler.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleRun}
        disabled={running}
      >
        {running ? "Running scheduler…" : "Run scheduler check now"}
      </button>

      {error ? (
        <p className="notice notice-error" style={{ marginTop: "12px" }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className="notice notice-ok"
          style={{ marginTop: "12px", fontSize: "13px" }}
        >
          <strong>Scheduler completed at {new Date(result.timestamp).toLocaleTimeString()}:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "20px" }}>
            <li>
              SLA breaches checked: {result.sla.firstResponseBreaches} first response,{" "}
              {result.sla.resolutionBreaches} resolution.
            </li>
            <li>SLA warnings issued: {result.sla.warningsIssued}.</li>
            <li>Auto-closed resolved tickets: {result.autoClosed}.</li>
            {result.mail.polled ? (
              <li>
                Inbound mail: {result.mail.orgsChecked} orgs checked, {result.mail.messagesCreated}{" "}
                created, {result.mail.messagesAppended} appended.
              </li>
            ) : (
              <li>Inbound mail: Polling skipped (no credentials configured).</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
