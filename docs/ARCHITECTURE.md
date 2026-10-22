# Architecture

pnpm monorepo, TypeScript strict. React UI, Next.js web app, PostgreSQL, plain SQL migrations.

```
apps/web        the site: pages + /api, imports @rr/ui and @rr/server
apps/worker     expiry sweeper, housekeeping, reconciliation, and the migrate/seed commands
apps/ui-hub     design gallery on a mock API (never deployed)
packages/ui     tokens, primitives, screens: the ONLY place UI code and CSS live
packages/core   contracts shared by everyone: data types, the API interfaces, ports, fixtures
packages/money  integer-paise helpers and outcome maths
packages/client HTTP implementation of the API the screens call
packages/server domain services, HTTP handler, built-in sign-in, security (no UI, no framework)
packages/db     SQL migrations, PostgreSQL and PGlite adapters, test harness
packages/auth   mock sign-in, email senders (SMTP, console)
packages/storage, packages/ai, packages/config   file storage, script writer, environment checks
```

## Pages

- `/`: the public KwikTask page. A route handler returns finished HTML (all search and share tags in `<head>`, JSON-LD, inline CSS from `@rr/ui/landing`, no JavaScript bundle), so crawlers and answer engines read it without running scripts. `robots.txt`, `sitemap.xml`, `manifest.webmanifest` and `llms.txt` sit beside it.
- `/app` (worker) and `/admin`: the apps, `noindex`, kept out of search by `robots.txt`.

## Request flow

```
browser -> /api/* (Next route) -> createApi(ctx):
   origin check -> session cookie -> CSRF token -> rate limit -> permission (admin routes) -> schema validation
   -> a server function (one transaction, row locks) -> PostgreSQL
```

The server functions know nothing about HTTP or Next; the HTTP handler is a plain `Request -> Response` function, so tests call it directly. The UI knows nothing about the server: it calls `Api` (in `@rr/core`), implemented over HTTP for the site and in memory for the gallery.

## Ports and adapters

Anything outside the repo is behind an interface in `packages/core/src/ports.ts`.

| Port | Real | Mock / placeholder |
|---|---|---|
| Sign-in | built-in provider (`@rr/server`), working | `createMockAuth`; Authgate adapter not written (implements the server `AuthProvider`) |
| Database | PostgreSQL (`pg`, any Postgres 14+, Vista to confirm); PGlite for local development | the same SQL on both |
| Email (one-time codes only) | SMTP (`@rr/auth/email`), working, 15-20 s timeouts | console sender (development only) |
| File storage | local disk (`@rr/storage/local`), one server | in-memory; S3 adapter not written |
| AI scripts | Anthropic (`@rr/ai`), written, not connected (`ANTHROPIC_API_KEY` + `AI_MODEL`) | deterministic mock; "not enabled" otherwise |
| Alerts | JSON webhook (Slack, Discord) when `ALERT_WEBHOOK_URL` is set | off |
| Payments | none: payers transfer by hand and attach a screenshot | no gateway, no UPI ID check |

## Data rules that live in the database

Append-only ledger, reviews, payments and audit log; one credit per submission; one payment per payout; one pending payout per user; one claim per email and task, ever; a debit cannot exceed the balance; financial foreign keys are RESTRICT. See `packages/db/migrations/` (0001 schema, 0002 payout rejection, 0003 audit fixes).

## Vista

Vista gives each Workspace its own isolated PostgreSQL database and handles access, migrations, readiness and recovery. Assumptions to confirm: **direct SQL access** (the ledger needs transactions, locks and triggers) and how Vista runs `migrations/*.sql`. `workspace_id` stays on every table although a Vista database holds one workspace.

## Layout

`<AppFrame>` measures its own width and sets `data-layout`: phone under 640px, tablet 640-1023px, desktop 1024px and up. Navigation is a bottom bar, an icon rail and a labelled sidebar; lists become tables from tablet up. CSS keys off that attribute, never the browser window, so the gallery can show all three side by side.

## Production

Only `apps/web` and `apps/worker` are built into images. The gallery is never deployed.
