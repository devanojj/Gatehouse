import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth";
import {
  getOrganization,
  inboundAddressFor,
  inboundCredentials,
  sharedInboxAddress,
} from "@/lib/orgs";

import { CheckMailButton } from "./CheckMailButton";
import { InboundAddress } from "./InboundAddress";
import { SupportEmailForm } from "./SupportEmailForm";

export default async function InboxSettingsPage() {
  // Any agent can check the mail — it is operational work, not administration.
  // Only owners get the form that changes the support address.
  const session = await requireSession();

  const org = await getOrganization(session.orgId);
  if (!org) notFound();

  const address = inboundAddressFor(org);
  const configured = inboundCredentials() !== null;
  // Whether this deployment can run the scheduled poll at all. The secret
  // itself never reaches the page — only whether one is set.
  const scheduled = Boolean(process.env.CRON_SECRET?.trim());

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>
            Mail sent to {session.orgName}&rsquo;s Gatehouse address becomes
            tickets here.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Your Gatehouse address</div>

        {address ? (
          <>
            <p className="muted" style={{ marginBottom: 16 }}>
              Every message delivered to this address lands in{" "}
              {session.orgName}&rsquo;s tickets — and nowhere else. The tag after
              the <code>+</code> is what identifies your workspace, so keep it
              intact.
            </p>
            <InboundAddress address={address} />
          </>
        ) : (
          <p className="notice notice-info">
            {org.inbound_slug
              ? "No shared inbox is configured on this server yet. Set GMAIL_USER to the mailbox that receives support mail."
              : "This workspace has no inbound address yet. Reload the page — one is generated automatically."}
          </p>
        )}
      </div>

      {address ? (
        <div className="card card-pad">
          <div className="section-title">Point your support address at it</div>
          <ol className="steps">
            <li>
              Open the forwarding settings of the mailbox your customers already
              write to
              {org.support_email ? (
                <>
                  {" "}
                  — <strong>{org.support_email}</strong>
                </>
              ) : null}
              . In Gmail that is Settings → Forwarding and POP/IMAP.
            </li>
            <li>
              Add <strong>{address}</strong> as a forwarding address and choose
              to forward incoming mail to it.
            </li>
            <li>
              Most providers email a confirmation code to the forwarding address
              first. That message arrives in the shared Gatehouse mailbox, so
              whoever administers{" "}
              <strong>{sharedInboxAddress() ?? "the shared inbox"}</strong> needs
              to pass the code back to you.
            </li>
            <li>
              Come back here and press <strong>Check for new mail</strong>. New
              senders open a ticket; replies carrying{" "}
              <code>[Ticket #12]</code> in the subject join the ticket they came
              from.
            </li>
          </ol>
        </div>
      ) : null}

      {session.role === "owner" ? (
        <div className="card card-pad">
          <div className="section-title">Support address</div>
          <p className="muted" style={{ marginBottom: 20 }}>
            The address your customers write to. Gatehouse shows it in the
            forwarding steps above; it does not affect how mail is routed.
          </p>
          <SupportEmailForm supportEmail={org.support_email} />
        </div>
      ) : null}

      <div className="card card-pad">
        <div className="section-title">Fetch mail</div>
        <p className="muted" style={{ marginBottom: 20 }}>
          {scheduled
            ? "Mail is collected on a schedule, and you can pull it in now as well. Only messages addressed to your workspace are read; the rest are left untouched."
            : "Mail is collected when you ask for it — this server has no schedule set up. Only messages addressed to your workspace are read; the rest are left untouched."}
        </p>
        <CheckMailButton disabled={!configured || !address} />

        {!configured ? (
          <p className="hint" style={{ marginTop: 12 }}>
            Checking is unavailable until GMAIL_USER and GMAIL_APP_PASSWORD are
            set on the server.
          </p>
        ) : null}

        {configured && !scheduled ? (
          <p className="hint" style={{ marginTop: 12 }}>
            Set CRON_SECRET on the server to let the scheduled poll run on a
            schedule.
          </p>
        ) : null}
      </div>

      <div className="card card-pad">
        <div className="section-title">How a reply is handled</div>
        <ul className="steps">
          <li>
            HTML-only mail is converted to readable text, and the quoted history
            a mail client staples underneath a reply is trimmed off. When the
            trimming is unsure, the whole message is kept.
          </li>
          <li>
            A reply to a ticket that is <strong>waiting on customer</strong> or{" "}
            <strong>resolved</strong> reopens it, so it comes back into the open
            views.
          </li>
          <li>
            A reply to a <strong>closed</strong> ticket is filed on it without
            reopening — closing is the deliberate end of a conversation. Reopen
            it by hand if the thread should carry on.
          </li>
        </ul>
      </div>

      <div className="card card-pad">
        <div className="section-title">What this does not do yet</div>
        <ul className="steps">
          <li>
            Nobody verifies that you own your support address — routing relies
            on the tagged address above being kept private to your forwarding
            rule.
          </li>
          <li>
            Attachments on inbound mail are not saved. Agents can attach files
            to a ticket from the composer.
          </li>
        </ul>
      </div>
    </>
  );
}
