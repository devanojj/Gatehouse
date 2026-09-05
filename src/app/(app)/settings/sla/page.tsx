import { saveSlaTargetsAction } from "@/app/actions/sla";
import { requireOwner } from "@/lib/auth";
import { getDefaultSlaPolicy, getEffectiveSlaTargets } from "@/lib/sla";

import { RunSchedulerButton } from "./RunSchedulerButton";

export default async function SlaSettingsPage() {
  const session = await requireOwner();
  const policy = await getDefaultSlaPolicy(session.orgId);
  const targets = await getEffectiveSlaTargets(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Service Level Agreements (SLA)</h1>
          <p>
            Configure response and resolution target deadlines for {session.orgName}.
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: "24px" }}>
        <div className="section-title">Target Deadlines ({policy.name})</div>
        <p className="hint" style={{ marginBottom: "20px" }}>
          Target hours determine when a ticket requires an agent&rsquo;s first public response
          and final resolution. When a deadline passes without action, the ticket is flagged as
          breached, an audit event is logged, and assignees are notified.
        </p>

        <form action={saveSlaTargetsAction}>
          <div className="table-wrap" style={{ marginBottom: "20px" }}>
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>First Response Target</th>
                  <th>Resolution Target</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="badge badge-red">High</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="high_response_hours"
                        min={1}
                        max={720}
                        defaultValue={targets.high.firstResponseHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="high_resolution_hours"
                        min={1}
                        max={2160}
                        defaultValue={targets.high.resolutionHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <span className="badge badge-amber">Medium</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="medium_response_hours"
                        min={1}
                        max={720}
                        defaultValue={targets.medium.firstResponseHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="medium_resolution_hours"
                        min={1}
                        max={2160}
                        defaultValue={targets.medium.resolutionHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>
                    <span className="badge badge-gray">Low</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="low_response_hours"
                        min={1}
                        max={720}
                        defaultValue={targets.low.firstResponseHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="number"
                        name="low_resolution_hours"
                        min={1}
                        max={2160}
                        defaultValue={targets.low.resolutionHours}
                        style={{ width: "90px" }}
                        required
                      />
                      <span className="muted">hours</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button className="btn btn-primary" type="submit">
            Save SLA targets
          </button>
        </form>
      </div>

      <div className="card card-pad">
        <div className="section-title">Background Scheduler & Cron</div>
        <p className="hint" style={{ marginBottom: "16px" }}>
          The background scheduler executes on a recurring schedule via <code>/api/cron</code>.
          It scans for SLA breaches, monitors warning windows, collects inbound mail, and auto-closes
          resolved tickets after 7 days.
        </p>
        <RunSchedulerButton />
      </div>
    </>
  );
}
