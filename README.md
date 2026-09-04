# Gatehouse

Multi-tenant ticketing. Several separate companies share one deployment, and
each organization sees only its own tickets, agents, and conversations.

- Next.js (App Router) + TypeScript
- Turso / libSQL through `@libsql/client` — raw SQL, no ORM
- Server Actions for every write; no REST or API route handlers
- Magic-link auth, no passwords; session token in an HTTP-only cookie — two
  separate realms, one for agents and one for customers
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

`npm test` runs the suite — tenant isolation, queues and claiming, the portal's
audience filter, the ticket status model, and the migration runner — against
throwaway SQLite files. No configuration needed.

Open http://localhost:3000 and create a workspace at `/signup`. With no
`RESEND_API_KEY` set, magic links are **printed to the server console** — copy
the `/login/verify?token=…` URL out of your terminal to sign in. That is the
entire login loop, with nothing else configured.

The database brings itself up to date on the first request, so there is still no
migration step to run by hand. Ordered migrations live in
[`src/lib/migrations.ts`](src/lib/migrations.ts); each one is applied inside a
write transaction together with the row recording it, so a half-applied
migration cannot be mistaken for a finished one, and two instances booting at
once cannot both apply the same change.

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
single-tenant schema won't have, and the baseline migration's
`CREATE TABLE IF NOT EXISTS` silently skips a conflicting table rather than
fixing it.

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
2. otherwise the sender's most recent open ticket receives it;
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

Not handled yet: attachments, HTML-only mail (the ticket is still created, with
a note in place of the body), trimming quoted reply text, reopening a closed
ticket when a reply arrives, and scheduled polling — collection is manual.

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
   opens a fresh ticket instead.

`src/proxy.ts` (Next.js 16 renamed Middleware to Proxy) only checks that a
session cookie exists, as an optimistic redirect. It deliberately does no
database work — the real check is `requireSession()` in the `(app)` layout, in
each page, and in every action.

## Layout

```
src/
  app/
    (app)/            signed-in shell — requireSession() runs here
      tickets/        list, new, detail
      settings/inbox/ inbound address, forwarding, fetch mail
      settings/team/  owner-only
    actions/          all server actions
    login/  signup/   magic-link auth
    ui/               logo, badges, nav
  o/[orgSlug]/        the customer portal — its own shell and sign-in
  lib/                db, auth, email, and per-table data access
    migrations.ts     ordered schema changes, applied on first use
    portal.ts         the one agent-side → customer-side conversion
  proxy.ts            optimistic cookie check, both realms
tests/                node --test, one scratch database per file
```

## The customer portal

Each organization has a portal at `/o/<portal-slug>` — the slug is readable and
generated from the name, deliberately *not* the inbound mail slug, whose random
suffix exists so a stranger cannot guess another tenant's address. Owners find
the link under **Settings → Inbox**.

Customers raise a request without an account. They get a reference number and a
confirmation link that opens that one ticket, read-only, for three days. To see
the conversation — or anything else they have raised — they sign in the same way
agents do: a link emailed to the address they wrote from.

Anyone who has ever emailed support is already a customer of that organization,
so signing in shows their emailed tickets too. `createTicket` links a requester
address to a customer record whatever door the ticket came through.

**What a customer can never see.** Internal notes, assignee names, queue names,
priorities, and SLA data. There is one conversion from an agent-side row to a
customer-side one — `toPortalTicket` and `toPortalMessages` in
[`src/lib/portal.ts`](src/lib/portal.ts) — and it builds a new object from named
fields rather than deleting fields from the row. A column added to `tickets`
tomorrow is invisible on the portal until somebody decides otherwise; the
failure mode is a missing field, not a leaked one.

**Two realms, never one.** Customers have their own table, their own magic
links, their own sessions, and their own cookie. A customer session can never
resolve to an agent, and a session belonging to one organization is treated as
signed out on another's portal. The org slug in the URL says which portal is
being *viewed*; it never says whose tickets may be read.

## Queues and ownership

Every organization has one default queue — "General" until it is renamed — and
every ticket belongs to exactly one queue and has at most one assignee. Owners
manage queues under **Settings → Queues**: create, rename, choose the default,
and delete. Deleting moves that queue's tickets to the default rather than
orphaning them, and the default itself cannot be deleted.

Agents move tickets between queues, assign them, or press **Claim this ticket**
to take an unassigned one. Claiming is a conditional `UPDATE … WHERE
assigned_agent_id IS NULL`, so two agents pressing it at the same moment cannot
both win — the database decides, and the page shows whoever did.

Queues group work; they do not restrict it. Every agent in an organization can
see and work every ticket in it. Per-queue access is a later decision, not an
omission.

## The ticket lifecycle

`open → in_progress → pending_customer → resolved → closed`. Any active status
can reach any other, or either end state. `closed` is the exception: the only
move out of it is back to `open`, and only an owner can make it. Until then a
closed ticket is read-only — no replies, no reassignment, no queue change — and
the controls that would fail are disabled rather than left to throw.

Reaching `resolved` or `closed` stamps `resolved_at`; moving back to any active
status clears it, so a reopened ticket stops counting as resolved.
`first_response_at` is stamped by the first public reply and never overwritten —
an internal note does not stop that clock. Replying with **Mark as waiting on
client** moves the ticket to `pending_customer` in the same action.

A client's reply joins whatever ticket it belongs to, including a `resolved`
one, which reopens it — a reply to something marked resolved is the case where
the fix did not work. A reply to a `closed` ticket opens a new one instead;
closed is final until a person says otherwise.

Everything that happens to a ticket other than the conversation — who opened it,
and every change of status, priority, assignee, or queue — is a row in
`ticket_events`, rendered in the Activity list alongside the messages. Both
tables are timestamped to the millisecond so the two interleave in the order
they actually happened.

## Deliberately not built

Billing/Stripe, multiple orgs per agent, SLAs and automation, a knowledge base,
reporting dashboards, domain verification for support addresses, scheduled mail
polling, and any Microsoft 365 integration.

## Notes

- One agent belongs to exactly one organization. `agents.email` is globally
  unique, so signing up with an email that already exists is refused.
- `/login/verify` validates the token on load but only *consumes* it when you
  press Continue. A cookie cannot be set while a Server Component renders, and
  the extra step keeps link-scanning email clients from burning a single-use
  token before the recipient clicks it.
