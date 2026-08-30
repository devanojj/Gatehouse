import { requireSession } from "@/lib/auth";

import { NewTicketForm } from "./NewTicketForm";

export default async function NewTicketPage() {
  await requireSession();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New ticket</h1>
          <p>Logged to your organization only.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 680 }}>
        <NewTicketForm />
      </div>
    </>
  );
}
