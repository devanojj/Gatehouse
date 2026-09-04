import { deleteQueueAction, setDefaultQueueAction } from "@/app/actions/queues";
import { requireOwner } from "@/lib/auth";
import { listQueuesWithCounts } from "@/lib/queues";

import { QueueForm } from "./QueueForm";
import { RenameForm } from "./RenameForm";

export default async function QueuesPage() {
  // Owner-only, like the rest of Settings; members are redirected.
  const session = await requireOwner();
  const queues = await listQueuesWithCounts(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Queues</h1>
          <p>Where {session.orgName}&rsquo;s work is grouped before anyone picks it up.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Address slug</th>
                <th>Open tickets</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {queues.map((queue) => (
                <tr key={queue.id}>
                  <td>
                    <RenameForm queueId={queue.id} name={queue.name} />
                  </td>
                  <td className="muted nowrap">
                    <span className="slug-cell">
                      <code>{queue.slug}</code>
                      {queue.is_default === 1 ? (
                        <span className="badge badge-teal">Default</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="num">{queue.open_tickets}</td>
                  <td>
                    {/* The flex row lives inside the cell, not on it: a `td`
                        that is itself a flex container drops out of the table
                        layout and its borders stop lining up. */}
                    <div className="row-actions">
                      {queue.is_default === 1 ? (
                        <span className="hint">New tickets arrive here.</span>
                      ) : (
                        <>
                          <form action={setDefaultQueueAction}>
                            <input type="hidden" name="queueId" value={queue.id} />
                            <button className="btn-link" type="submit">
                              Make default
                            </button>
                          </form>
                          <form action={deleteQueueAction}>
                            <input type="hidden" name="queueId" value={queue.id} />
                            <button className="btn-link btn-link-danger" type="submit">
                              Delete
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Add a queue</div>
        <QueueForm />
      </div>

      <p className="hint">
        Deleting a queue moves its tickets to the default one — nothing is lost,
        and no ticket is left without somewhere to be.
      </p>
    </>
  );
}
