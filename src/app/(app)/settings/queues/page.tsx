import Link from "next/link";

import { deleteQueueAction, removeQueueMemberAction } from "@/app/actions/queues";
import { listAgents } from "@/lib/agents";
import { requireOwner } from "@/lib/auth";
import { listQueueMembers, listQueues } from "@/lib/queues";

import { AddMemberForm } from "./AddMemberForm";
import { QueueForm } from "./QueueForm";

export default async function QueuesPage() {
  // Owner-only, like the team page: queues decide who is expected to answer
  // what. Members are redirected back to their tickets.
  const session = await requireOwner();

  const [queues, agents] = await Promise.all([
    listQueues(session.orgId),
    listAgents(session.orgId),
  ]);

  const membersByQueue = await Promise.all(
    queues.map((queue) => listQueueMembers(session.orgId, queue.id)),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Queues</h1>
          <p>
            Departments inside {session.orgName}. A ticket sits in one queue, and
            the people in that queue see it in their own views.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Create a queue</div>
        <QueueForm />
      </div>

      {queues.length === 0 ? (
        <div className="card">
          <p className="empty">
            No queues yet. Billing, Onboarding and Infrastructure are the usual
            first three.
          </p>
        </div>
      ) : null}

      {queues.map((queue, index) => {
        const members = membersByQueue[index];
        const memberIds = new Set(members.map((member) => member.agent_id));

        return (
          <div className="card card-pad" key={queue.id}>
            <div className="section-title">
              {queue.name}
              <span className="tab-count">
                {queue.open_count ?? 0} open ·{" "}
                {members.length === 1 ? "1 agent" : `${members.length} agents`}
              </span>
            </div>

            <QueueForm
              queue={{
                id: queue.id,
                name: queue.name,
                description: queue.description,
              }}
            />

            <div className="stack" style={{ marginTop: 20 }}>
              {members.length === 0 ? (
                <p className="muted">Nobody is in this queue yet.</p>
              ) : (
                <div>
                  {members.map((member) => (
                    <div className="list-row" key={member.agent_id}>
                      <div className="list-row-main">
                        <div className="list-row-title">{member.name}</div>
                        <div className="muted">{member.email}</div>
                      </div>
                      <div className="list-row-actions">
                        <form action={removeQueueMemberAction}>
                          <input
                            type="hidden"
                            name="queueId"
                            value={queue.id}
                          />
                          <input
                            type="hidden"
                            name="agentId"
                            value={member.agent_id}
                          />
                          <button className="btn btn-danger" type="submit">
                            Remove
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <AddMemberForm
                queueId={queue.id}
                candidates={agents
                  .filter((agent) => !memberIds.has(agent.id))
                  .map((agent) => ({ id: agent.id, name: agent.name }))}
              />
            </div>

            <div className="form-actions">
              <form action={deleteQueueAction}>
                <input type="hidden" name="queueId" value={queue.id} />
                <button className="btn btn-danger" type="submit">
                  Delete queue
                </button>
              </form>
              <span className="hint" style={{ marginTop: 0 }}>
                Its {queue.open_count ?? 0} open tickets stay, with no queue.
              </span>
            </div>
          </div>
        );
      })}

      <div className="card card-pad">
        <div className="section-title">Who can be in a queue</div>
        <p className="muted">
          Only people on <Link href="/settings/team">your team</Link>. A queue and
          its members always belong to the same organization, so a ticket can
          never be routed outside {session.orgName}.
        </p>
      </div>
    </>
  );
}
