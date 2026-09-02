# Gatehouse

Multi-tenant ticketing. Several separate companies share one deployment, and
each organization sees only its own tickets, agents, and conversations.

- Next.js (App Router) + TypeScript
- Turso / libSQL through `@libsql/client` — raw SQL, no ORM
- Server Actions for every write. Two route handlers exist and only two:
  downloading an attachment, which has to return bytes to a browser, and the
  scheduled inbound poll, which is called by a cron with a shared secret
- Magic-link auth, no passwords; session token in an HTTP-only cookie
- Plain CSS, one `globals.css` of variables — no Tailwind, no UI library

## Running it locally

You do not need a Turso account or an email provider to run this.

```bash
npm install
```

```bash
cp .env.local.example .env.local
```

Set the database URL to a local SQLite file:

```
TURSO_DATABASE_URL=file:./gatehouse.db
```

Then start the dev server:

```bash
npm run dev
```

Open http://localhost:3000 and create a workspace at `/signup`. With no
`RESEND_API_KEY` set, magic links are **printed to the server console** — copy
the `/login/verify?token=…` URL out of your terminal to sign in. That is the
entire login loop, with nothing else configured.

Tables are created lazily on first request, so there is no migration step.
Columns added after the first release are applied the same way: on connection,
Gatehouse checks for them and runs `ALTER TABLE` if they are missing.

## Hosted database

```bash
turso db create gatehouse
```

Then read off the two values you need:

```bash
turso db show gatehouse --url
```

```bash
turso db tokens create gatehouse
```

Put them in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Use a **fresh**
database — Gatehouse's `tickets` and `comments` tables carry an `org_id` that a
single-tenant schema won't have, and `CREATE TABLE IF NOT EXISTS` silently
skips a conflicting table rather than fixing it.

## Sending real email

Set `RESEND_API_KEY` (and `EMAIL_FROM` for your own domain). That is the only
change needed — [`src/lib/email.ts`](src/lib/email.ts) is the single seam
between the app and an email provider. Also set `APP_URL`, so links in those
emails point at your deployment instead of localhost.

## Inbound email

Customers write to an address; their mail becomes tickets. One shared Gmail
mailbox serves every tenant, and plus-addressing keeps them apart: each
organization gets a generated `inbound_slug` and publishes
`shared-inbox+<slug>@gmail.com`.

Set the mailbox credentials on the server:

```
GMAIL_USER=your-shared-inbox@gmail.com
GMAIL_APP_PASSWORD=an-app-specific-password
```

Use a [Google App Password](https://support.google.com/accounts/answer/185833),
not the account password, and enable IMAP on the mailbox. `INBOUND_IMAP_HOST`
and `INBOUND_IMAP_PORT` default to `imap.gmail.com:993` if you are pointing at
something other than Gmail.

Each org then opens **Settings → Inbox**, copies its address, and forwards its
own support mailbox to it. Pressing **Check for new mail** connects over IMAP
and files anything unread that was addressed to that org:

1. a `[Ticket #12]` marker in the subject wins — the reply joins that ticket;
2. otherwise the sender's most recent ticket that is not closed receives it;
3. otherwise a new ticket is opened, with the sender as its requester.

Filed messages are flagged `\Seen`. A message that fails to file is left unread
and retried on the next check, and the message id is recorded on the row so a
re-delivery (or someone marking the mail unread again) cannot duplicate it.

Replies an agent sends from a ticket go out under the organization's name, with
`Reply-To` set to that org's inbound address and `[Ticket #N]` on the subject,
so the customer's answer comes back to the same ticket.

**Routing is by slug only.** An organization's `support_email` is self-declared
and nobody verifies it, so it is used for display and never for deciding which
tenant a message belongs to. Mail that reaches the shared inbox without a
recognized `+slug` is left untouched.

An inbound message is cleaned up before it is filed
([`src/lib/mail-text.ts`](src/lib/mail-text.ts)): HTML-only mail is flattened to
readable text, and the quoted history and signature a mail client staples under
a reply are trimmed. Both are conservative — if trimming would leave nothing,
the whole message is kept, because losing a customer's words is worse than a
long thread.

A reply also moves the ticket along. Landing on a `pending` or `resolved`
ticket reopens it to `open` and records a system notice on its timeline. A
`closed` ticket is deliberately left closed: closing is the end of a
conversation, so the reply is filed on it and an agent reopens it by hand if the
thread should carry on.

Not handled yet: attachments *on* inbound mail. Agents can attach files to a
ticket from the composer.

### Scheduled polling

`/api/cron/inbound` polls every organization that has an inbound address, using
the same `fetchInboundMail` the Settings button uses — one implementation, one
set of routing rules. It takes nothing from the request but the secret:

```
CRON_SECRET=$(openssl rand -hex 32)
```

The route accepts `Authorization: Bearer $CRON_SECRET` and refuses everything
else with a 401; with no secret configured it refuses every request rather than
defaulting to open. Vercel Cron sends that header automatically when the project
has a `CRON_SECRET` environment variable — so deploying means setting the
variable in the project's settings and redeploying, nothing else.

[`vercel.json`](vercel.json) schedules it **once a day**, at 08:00 UTC, because
that is the most a Hobby account allows: a cron expression that would run more
than once a day [fails the deployment
outright](https://vercel.com/docs/cron-jobs/usage-and-pricing). That daily run
is a backstop. The real schedule lives in GitHub Actions, which costs nothing.

### Polling every fifteen minutes without a paid plan

Nothing about `/api/cron/inbound` is Vercel-specific — it authenticates a
`Bearer` token and takes nothing else from the request, so any clock that can
send a header can drive it.
[`.github/workflows/inbound-poll.yml`](.github/workflows/inbound-poll.yml) is
that clock: a scheduled workflow that calls the deployment every fifteen
minutes. Scheduled workflows are free on a public repository, and free within
the monthly Actions minutes on a private one.

Set it up once, in this repository under **Settings → Secrets and variables →
Actions**:

| | |
| --- | --- |
| Variable `GATEHOUSE_URL` | `https://your-deployment.vercel.app` |
| Secret `CRON_SECRET` | the same value as `CRON_SECRET` in the Vercel project |

Then open the **Actions** tab and run **Poll inbound mail** once by hand. A
green run that prints `{"ok":true,…}` means the whole path works. The workflow
reports a wrong secret (401) and an unreachable deployment as failures, and a
server with no mailbox configured (503) as a notice rather than a failure, so it
does not email you every fifteen minutes before `GMAIL_USER` is set.

Two things to know about GitHub's scheduler: runs are best effort, so one can be
late or skipped when the platform is busy — the poll is idempotent, so a missed
run simply collects more mail next time — and GitHub disables scheduled
workflows in a repository with no activity for 60 days, which the Vercel daily
cron quietly covers.

Any other scheduler works the same way, as long as it can send a header:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-deployment.vercel.app/api/cron/inbound
```

Do not put the secret in the query string of a service that cannot: URLs end up
in logs.

One organization's failure — a locked mailbox, a malformed message — is caught
and the rest are still polled. The response counts what happened across the
deployment; per-tenant detail stays in the server log.

The manual **Check for new mail** button is unchanged and still works with no
secret set.

## Working a ticket

**Lifecycle.** A ticket is `open`, `pending` (waiting on the customer),
`in-progress`, `resolved`, or `closed`. The first three are the *active*
statuses — the ones the saved views count as still needing someone. `resolved`
is an answer holding until the customer accepts it; `closed` is the end.

**Queues** are departments. An owner creates them under **Settings → Queues**
and puts teammates in them; a ticket sits in at most one queue, chosen from the
ticket page or when it is created. An agent's own queues appear as views on the
ticket list, with a count of what is still open in each.

**Saved views** on `/tickets`: all tickets, my open tickets, unassigned,
waiting on customer, and urgent (high priority and still active). They compose
with the status tabs, the queue filter, and search, and every one of them is
just a set of filters on the same org-scoped query — `view=mine` takes the
agent id from the session, so it cannot be pointed at anyone else. **Take it**
on a ticket assigns it to whoever pressed it.

There are no SLA fields, so "overdue" is not tracked; urgent is priority-based.

**Macros** are saved replies, written under **Settings → Macros** and inserted
from the composer. They may use `{{requester_name}}`, `{{requester_email}}`,
`{{ticket_number}}`, `{{ticket_subject}}`, `{{agent_name}}` and `{{org_name}}`;
anything else in double braces is left exactly as typed, so a typo shows up in
the draft instead of eating the sentence around it. Interpolation happens on the
server, against the ticket being viewed — the composer receives finished text.

**The timeline.** `ticket_events` records status, priority, assignee and queue
changes, claims, creation, and inbound reopens. It is append-only: rows are
written in the same transaction as the change they describe (`batchWrite` in
[`src/lib/db.ts`](src/lib/db.ts)), and nothing updates or deletes one. Values
are stored as display text at write time, inside the organization the event
belongs to, so rendering a timeline never joins back out to another table.

**Search** is in the top bar of the signed-in shell and routes to
`/tickets?q=…`. It matches ticket number, subject, requester address,
description, and comment bodies — all within the current organization, all
through `?` placeholders, with `%` and `_` escaped so a typed wildcard cannot
widen the match. Results are capped and keep whatever view and filters are
already applied. It is plain SQL `LIKE` on SQLite; there is no search service.

## Attachments

Agents can attach screenshots, logs, PDFs and similar files to a reply or an
internal note. Files are validated server-side: an extension from a fixed
allow-list, a size limit of 10MB, and a magic-byte check that the bytes match
the extension. Nothing about the upload is taken from the browser — not the
filename (stripped to a safe basename) and not the content type (decided from
the allow-list). Nothing that a browser executes in place is accepted; there is
no HTML and no SVG on the list.

Downloads go through `/api/attachments/[id]`, which resolves the id inside the
caller's own organization before returning a byte — an id from another tenant is
a 404, and the storage key is never exposed. Files are served as downloads with
`X-Content-Type-Options: nosniff`.

Storage has two backends behind one seam
([`src/lib/storage.ts`](src/lib/storage.ts)):

- **Any S3-compatible bucket** when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
  `S3_SECRET_ACCESS_KEY` are set — AWS, R2, MinIO, Spaces. `S3_REGION` defaults
  to `us-east-1`, `S3_ENDPOINT` to AWS, and `S3_FORCE_PATH_STYLE=true` puts the
  bucket in the path, which R2 and MinIO want. Requests are signed with SigV4
  directly, so there is no AWS SDK in the dependency tree.
- **A local directory** (`ATTACHMENTS_DIR`, default `./.gatehouse-uploads`)
  when they are not, so attachments work in development with no credentials at
  all. That fallback is refused in production, where a serverless filesystem
  does not outlive the request.

## How tenant isolation works

Isolation is enforced in depth rather than in one place:

1. **The session is the only source of `org_id`.** The cookie resolves through
   `sessions` → `agents` → `organizations` in `getSession()`
   ([`src/lib/auth.ts`](src/lib/auth.ts)). An `org_id` is never read from a
   form field, query string, or route param.
2. **Every read and write takes `org_id` explicitly** and puts it in the
   `WHERE` clause ([`src/lib/tickets.ts`](src/lib/tickets.ts),
   [`src/lib/comments.ts`](src/lib/comments.ts)). A ticket id alone never
   reaches a row.
3. **`comments` carries its own `org_id`**, filtered directly instead of
   joined through `tickets`, as a safety net.
4. **Server Actions re-check on every call.** They are reachable by direct
   POST, so `requireTicketAccess()`
   ([`src/app/actions/tickets.ts`](src/app/actions/tickets.ts)) re-resolves any
   client-supplied ticket id against the caller's own org first.
5. **Assignment can't cross tenants.** `updateAssignee` resolves the agent id
   through a subquery scoped to the same org, so a foreign agent id becomes
   `NULL` instead of an assignment.
6. **Inbound mail picks a tenant by slug, then stays in it.** The check-mail
   action takes the org from the session, reads only messages tagged with that
   org's slug, and files them through the same org-scoped functions — so a
   `[Ticket #N]` marker naming another tenant's ticket resolves to nothing and
   opens a fresh ticket instead. The scheduled poll iterates organizations from
   the database and runs the same code per organization; it reads no tenant from
   the request.
7. **Queues can't be staffed or filled across tenants.** A membership row is
   built by a SELECT that joins the queue to the agent on a shared `org_id`, so
   a foreign agent id inserts nothing; a ticket's queue is resolved by the same
   subquery shape as its assignee, so a foreign queue id becomes `NULL`.
8. **Attachments are reached by org, not by id.** `attachments` carries its own
   `org_id`, the download route resolves the id inside the session's org, and a
   row is only ever written by a statement that selects the ticket out of the
   same org first.
9. **The timeline is written and read inside one org.** The event insert selects
   its `org_id` from the ticket it describes and resolves the acting agent
   inside that org, so an event can neither be attached to another tenant's
   ticket nor credited to a stranger.

`src/proxy.ts` (Next.js 16 renamed Middleware to Proxy) only checks that a
session cookie exists, as an optimistic redirect. It deliberately does no
database work — the real check is `requireSession()` in the `(app)` layout, in
each page, and in every action.

## Layout

```
src/
  app/
    (app)/             signed-in shell — requireSession() runs here
      tickets/         list with saved views, new, detail with timeline
      settings/inbox/  inbound address, forwarding, fetch mail
      settings/macros/ saved replies
      settings/queues/ owner-only
      settings/team/   owner-only
    api/attachments/   authenticated download
    api/cron/inbound/  scheduled poll, CRON_SECRET
    actions/           all server actions, one file per domain
    login/  signup/    magic-link auth
    ui/                logo, badges, nav
  lib/                 db, auth, email, storage, mail text, per-table access
  proxy.ts             optimistic cookie check
```

## Deliberately not built

Billing/Stripe, multiple orgs per agent, SLAs and automation, a knowledge base,
reporting dashboards, domain verification for support addresses, a customer
portal, and any Microsoft 365 integration.

## Notes

- One agent belongs to exactly one organization. `agents.email` is globally
  unique, so signing up with an email that already exists is refused.
- `/login/verify` validates the token on load but only *consumes* it when you
  press Continue. A cookie cannot be set while a Server Component renders, and
  the extra step keeps link-scanning email clients from burning a single-use
  token before the recipient clicks it.
