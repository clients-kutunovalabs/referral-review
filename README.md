# referral-review: multi-purpose task board

Workers claim tasks, do the work, upload a screenshot, get reviewed by an admin and paid to a wallet, then withdraw by UPI (manual transfer with recorded proof). Beta use: our own sales team. Website only (responsive + PWA).

Full plan: [docs/PLAN.md](docs/PLAN.md).

## Status

| Step | State |
|---|---|
| Repo structure, design system, admin + user UI | done |
| Sign-in screens, ports and adapters, tablet and desktop layouts | done |
| Backend: database, sign-in, claims, reviews, money, payouts, support | done, tested |
| Web app, worker, Docker, CI | done; the Docker image itself is not yet built or run |
| Launch | needs your Vista, mail server, domain and legal text: see [docs/DEPLOY.md](docs/DEPLOY.md) |

Everything done, every issue found and fixed, and everything deferred: [docs/WORKLOG.md](docs/WORKLOG.md).

## Run it

```
npm run dev           # http://localhost:3000. Installs with pnpm on first run (fetches pnpm if you lack it). Embedded database; sign-in codes are printed in this terminal.
```
(Plain `npm install` is blocked on purpose: the workspace needs pnpm. `npm run dev` does the install for you. Windows, macOS and Linux; Node 20+.)
Set `OWNER_EMAIL` and `OWNER_PASSWORD` first to get an admin login at `/admin`.

```
pnpm dev:hub          # the design gallery with demo data: phone, tablet and desktop previews
pnpm check            # lint, typecheck, all tests (set TEST_DATABASE_URL to also test on real Postgres)
pnpm e2e              # the whole product in real browsers: see e2e/README.md
pnpm worker           # background jobs (needed in production)
pnpm db:migrate | db:seed | reconcile
```

Gallery demo logins: `priya@gmail.com` (user) and `hrishabh@example.com` (admin), password `password123`; every code is `123456`.

## Layout

```
apps/web        the site (Next.js) + /api
apps/worker     expiry sweeper, housekeeping, reconciliation, migrate/seed
apps/ui-hub     design gallery on demo data (never deployed)
packages/ui     tokens, primitives, user + admin screens: the ONLY place UI code lives
packages/core   contracts, API interfaces, ports
packages/server domain services, HTTP handler, sign-in, security
packages/db     SQL migrations, Postgres + PGlite adapters
packages/client, money, auth, storage, ai, config
```

## Rules

- One UI source: no `.css` outside `packages/ui` (enforced by `scripts/check-boundaries.mjs`).
- Money is integer paise (`bigint`), never a JS number. See [docs/MONEY.md](docs/MONEY.md).
- The database enforces the money rules, not just the code. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The gallery is not built or deployed in production.

