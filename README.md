# referral-review: multi-purpose task board

Workers claim tasks, do the work, upload a screenshot, get reviewed by an admin and paid to a wallet, then withdraw by UPI (manual transfer with recorded proof). Beta use: our own sales team. Website only (responsive + PWA).

Full plan: [docs/PLAN.md](docs/PLAN.md).

## Status

| Step | State |
|---|---|
| 1. Repo structure | done |
| 2. Design system (tokens, primitives) | done |
| 3. Admin + user flow UI in ui-hub | done, waiting for sign-off |
| 4+. Backend (DB, auth/RBAC, claims, payouts) | not started |

## Run the UI hub

```
corepack enable            # once, gives you pnpm
pnpm install
pnpm dev:hub               # http://localhost:5173
```

- `/` user app (all screens, tap-through or "show all screens")
- `/admin` admin app (switch "View as" role to see permission-gated navigation)
- `/design-system` tokens, typography, every primitive

## Checks

```
pnpm check                 # boundary check, eslint, typecheck, tests
pnpm build:hub
```

## Layout

```
apps/ui-hub     dev/staging gallery (never deployed to production)
apps/web        real user site + /admin (later; imports @rr/ui only)
apps/worker     claim-expiry + reconciliation jobs (later)
packages/ui     tokens, primitives, user + admin screens: the ONLY place UI code lives
packages/money  integer-paise Money helpers + outcome maths (tested)
packages/core   domain contracts + mock fixtures the UI consumes
packages/db, auth, storage, ai, config   placeholders for the backend phase
```

## Rules

- One UI source: no `.css` outside `packages/ui` (enforced by `scripts/check-boundaries.mjs`). ui-hub and the real web app import the same components.
- Money is integer paise (`bigint`), never a JS number. See [docs/MONEY.md](docs/MONEY.md).
- ui-hub is not built or deployed in production. The design system is internal only.
