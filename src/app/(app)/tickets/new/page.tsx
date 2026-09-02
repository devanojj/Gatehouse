import { requireSession } from "@/lib/auth";
import { listQueues } from "@/lib/queues";

import { NewTicketForm } from "./NewTicketForm";

export default async function NewTicketPage() {
  const session = await requireSession();
  const queues = await listQueues(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New ticket</h1>
          <p>Logged to your organization only.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 680 }}>
        {/* Plain props: the form never sees a query or an org id. */}
        <NewTicketForm
          queues={queues.map((queue) => ({ id: queue.id, name: queue.name }))}
        />
      </div>
    </>
  );
}
