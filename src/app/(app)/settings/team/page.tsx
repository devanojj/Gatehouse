import { listAgents } from "@/lib/agents";
import { requireOwner } from "@/lib/auth";
import { formatDate } from "@/lib/format";

import { InviteForm } from "./InviteForm";

export default async function TeamPage() {
  // Owner-only; members are redirected back to their tickets.
  const session = await requireOwner();
  const agents = await listAgents(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Everyone with access to {session.orgName}&rsquo;s tickets.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td style={{ fontWeight: 500 }}>{agent.name}</td>
                  <td className="muted">{agent.email}</td>
                  <td>
                    <span
                      className={`badge ${
                        agent.role === "owner" ? "badge-teal" : "badge-gray"
                      }`}
                    >
                      {agent.role === "owner" ? "Owner" : "Member"}
                    </span>
                  </td>
                  <td className="muted nowrap">{formatDate(agent.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Invite a teammate</div>
        <p className="muted" style={{ marginBottom: 20 }}>
          They join {session.orgName} as a member and can see every ticket here.
        </p>
        <InviteForm />
      </div>
    </>
  );
}
