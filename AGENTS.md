<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Gatehouse

[README.md](README.md) is the source of truth for architecture, setup, environment
variables, and the tenant-isolation rules — read it first. This file covers only
what it doesn't: conventions, how to verify a change, and what to re-check.

## Conventions

**Data access — `src/lib/*.ts`**

- Every module opens with `import "server-only"`.
- Raw SQL through `query` / `queryOne` / `insert` / `execute`
  ([`src/lib/db.ts`](src/lib/db.ts)). Always `?` placeholders, never
  interpolation.
- Every tenant-scoped function takes `orgId` as its **first** parameter and puts
  it in the `WHERE` clause. A row id on its own is never enough.
- Schema changes: new tables go in `SCHEMA`. A new column on an existing table
  must *also* go in `ADDED_COLUMNS` — `CREATE TABLE IF NOT EXISTS` silently skips
  a table that already exists, so a live database never gets the column
  otherwise. Indexes over those columns belong in `POST_MIGRATION_INDEXES`.

**Server Actions — `src/app/actions/*.ts`**

- One file per domain, `"use server"` at the top.
- Name new actions `<verb><Noun>Action` (`createTicketAction`). The auth entry
  points — `login`, `signup`, `logout` — predate the suffix.
- Two error styles, deliberately. Actions wired to a form through
  `useActionState` return `{ error }` from a `…State` type: the user can fix the
  input. Actions returning `Promise<void>` **throw** — a bad value there means a
  hand-crafted POST, not a typo.
- Narrow untrusted form values with a type guard (`isStatus`, `isPriority`,
  `isAgentCommentType`), never a cast.
- End with `revalidatePath` for every route the write affects, then `redirect`
  if the user should move.

**Components**

- Server by default. `"use client"` only for genuine interactivity —
  `useActionState`, clipboard, controlled selects. There are ten client
  components; keep that list short.
- Pages are `export default async function`; everything else is a named export.
- Client components take plain props and call an action. They never import from
  `@/lib/*`.

**Styling**

- One `src/app/globals.css` (~760 lines) of CSS variables. No Tailwind, no UI
  library, no CSS modules.
- Reuse the existing vocabulary — `card`/`card-pad`, `btn`/`btn-primary`/
  `btn-secondary`, `notice`/`notice-error`/`notice-info`, `badge-*`, `muted`,
  `hint`, `steps` — and add new classes to `globals.css` rather than inlining
  styles, one-off spacing aside.

**Imports** use the `@/` alias, ordered `server-only` → third-party → `@/` →
relative.

## Verifying a change

There is no test runner. `npm run lint` and `npm run build` are the only
automated checks; everything else is exercised by hand against a scratch
database:

```bash
TURSO_DATABASE_URL=file:./scratch.db npm run dev
```

- **Never point a local run at the hosted database.** `.env.local` holds the
  production Turso URL, so a plain `npm run dev` writes real tenant rows. A
  `file:` URL needs no auth token and builds its schema on the first request.
- Isolation changes need two organizations, not one. The test is that org B's
  id — in a form field, a URL, or a `[Ticket #N]` subject marker — reads as
  "not found" instead of working.
- Leave `RESEND_API_KEY` and the `GMAIL_*` variables unset locally. Magic links
  print to the server console and Settings → Inbox explains what is missing, so
  the whole app runs with no provider configured.
- If you add a test runner, add a `test` script alongside `lint` so it is
  discoverable.

## When you change X, check Y

- **A `lib/` query** — does it take `orgId`, and is `orgId` in the `WHERE`?
- **The schema** — `SCHEMA`, `ADDED_COLUMNS`, `POST_MIGRATION_INDEXES`, and does
  an existing row need backfilling the way `backfillInboundSlugs` does?
- **A Server Action** — does it re-resolve every client-supplied id against the
  session's org before use?
- **Inbound routing or threading** — README "How tenant isolation works" (6) and
  the threading rules in [`src/lib/inbound.ts`](src/lib/inbound.ts).
- **An environment variable** — `.env.local.example`, the matching README
  section, and Vercel production. A variable added *after* a deployment is not
  in the running build until you redeploy. `CRON_SECRET` lives in two places:
  the Vercel project and the repository secret the polling workflow reads.
- **A ticket mutation** — does it write a `ticket_events` row in the same
  `batchWrite`, and does that event resolve its values in SQL rather than take
  a label from the caller ([`src/lib/ticket-events.ts`](src/lib/ticket-events.ts))?
- **A status** — `STATUSES`, `ACTIVE_STATUSES`, `REOPEN_STATUSES`,
  `STATUS_LABELS`/`STATUS_SHORT_LABELS`, the badge tone in
  [`src/app/ui/Badge.tsx`](src/app/ui/Badge.tsx), the list views, and the
  inbound reopen rule.
- **Attachments or storage** — the allow-list and magic-byte check in
  [`src/lib/attachments.ts`](src/lib/attachments.ts), and both backends in
  [`src/lib/storage.ts`](src/lib/storage.ts). The download route is the one
  place that serves bytes; it must keep resolving the id inside the session's
  org.
