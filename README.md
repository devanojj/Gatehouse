# Gatehouse

Multi-tenant ticketing. Several separate companies share one deployment, and
each organization sees only its own tickets, agents, and conversations.

- Next.js (App Router) + TypeScript
- Turso / libSQL through `@libsql/client` — raw SQL, no ORM
- Server Actions for every write; no REST or API route handlers
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
  lib/                db, auth, email, and per-table data access
  proxy.ts            optimistic cookie check
```

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
