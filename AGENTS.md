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
  it in the `WHERE` clause. A row id on its own is never enough. A function
  reading a customer's own data takes `customerId` as well, and both go in the
  `WHERE`: the org alone would show them the whole queue.
- Schema changes go in [`src/lib/migrations.ts`](src/lib/migrations.ts), as a new
  entry appended to `MIGRATIONS` — never by editing an entry that has already
  shipped, and never by renaming one: the name is what records it as applied, so
  a rename runs it again on every existing database. Each migration runs in a
  write transaction with the row that records it, and the runner brings the
  database up to date on the first query of the process.
- Write an `up` that is safe to run twice (`IF NOT EXISTS`, `WHERE`-guarded
  updates, the `addColumn` helper). The transaction makes that belt-and-braces
  rather than load-bearing, but it keeps a migration usable as a repair.

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

`npm run lint`, `npm run build`, and `npm test` are the automated checks. The
tests run on Node's own runner against a throwaway SQLite file — one per test
file, created and deleted by [`tests/helpers/harness.mts`](tests/helpers/harness.mts).
They are `.mts` because the package is CommonJS and the harness needs top-level
`await`; the `--conditions=react-server` flag is what lets a module importing
`server-only` load outside Next.

Anything the tests do not cover is exercised by hand against a scratch database:

```bash
npm run dev:scratch
```

That is `TURSO_DATABASE_URL=file:./scratch.db next dev` — a shell variable wins
over `.env.local`, which is the only thing keeping a local run off the hosted
database.

- **Never point a local run at the hosted database.** `.env.local` holds the
  production Turso URL, so a plain `npm run dev` writes real tenant rows. A
  `file:` URL needs no auth token and builds its schema on the first request.
- Isolation changes need two organizations, not one. The test is that org B's
  id — in a form field, a URL, or a `[Ticket #N]` subject marker — reads as
  "not found" instead of working. Add the case to
  [`tests/isolation.test.mts`](tests/isolation.test.mts) rather than only
  clicking it: every exported `lib/` function that takes an `orgId` belongs
  there.
- Leave `RESEND_API_KEY` and the `GMAIL_*` variables unset locally. Magic links
  print to the server console and Settings → Inbox explains what is missing, so
  the whole app runs with no provider configured.

## When you change X, check Y

- **A `lib/` query** — does it take `orgId`, and is `orgId` in the `WHERE`?
- **The schema** — is it a new entry at the end of `MIGRATIONS`, and does an
  existing row need backfilling the way `backfillInboundSlugs` does? Add the
  before/after to `tests/migrations.test.mts` if a live database would notice.
- **A Server Action** — does it re-resolve every client-supplied id against the
  session's org before use, does a change worth remembering reach `recordEvent`,
  and is it refused on a closed ticket?
- **Anything the customer portal renders** — does it come through
  `toPortalTicket` / `toPortalMessages`? Those are the only conversion from an
  agent-side row to a customer-side one, and they build a new object from named
  fields on purpose. Never render a `Ticket` or a `Comment` under `app/o/`.
- **A control on the ticket page** — a closed ticket is read-only. Disable the
  control as well as refusing the write, so the UI never offers something the
  action will only throw on.
- **Inbound routing or threading** — README "How tenant isolation works" (6) and
  the threading rules in [`src/lib/inbound.ts`](src/lib/inbound.ts).
- **An environment variable** — `.env.local.example`, the matching README
  section, and Vercel production. A variable added *after* a deployment is not
  in the running build until you redeploy.
