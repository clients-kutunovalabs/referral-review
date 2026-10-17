# Architecture

- pnpm monorepo, TypeScript strict. UI: React. Backend (later): Next.js route handlers + Node services, Postgres, Drizzle.
- `packages/ui` owns all visuals. `apps/ui-hub` renders them with mock data from `packages/core` fixtures. `apps/web` will render the same components with real data.
- `packages/core` contracts define the domain types the UI consumed; the backend implements exactly these.
- Workspace-ready: every domain table gets `workspace_id` from day one (single seeded workspace for now; isolation/RLS later).
- Claim uniqueness: `(identity_id, template_id)`. One login owns several identities (emails) and one wallet; ledger rows carry `identity_id`.
- Production excludes ui-hub. The production image builds only `apps/web` and `apps/worker`.

## Ports and adapters

Anything outside the repo sits behind an interface in `packages/core/src/ports.ts`: `AuthPort`, `EmailVerificationPort`, `EmailSenderPort`, `StoragePort`, `AiPort`. The UI never imports a vendor; it reads them from `<ServicesProvider>`.

| Port | Mock (ui-hub, tests) | Real adapter (placeholder until credentials arrive) |
|---|---|---|
| Auth | `@rr/auth` `createMockAuth` | `createAuthgateAuth({ url })` |
| Extra-email codes (site-owned) | `createMockEmailVerification` | same logic over the DB + email sender |
| Outgoing email | `createOutbox` | Authgate's default sender first, a real sender later |
| File storage | `@rr/storage` `createMockStorage` | `createObjectStorage` (S3-compatible, private bucket) |
| AI script | `@rr/ai` `createMockAi` | `createAnthropicAi` |
| Database | not yet (step 4) | Vista, managed PostgreSQL, behind `@rr/db` |

The mock auth enforces the same one-time-code rules the real service must: 6 digits, 10 minute expiry, 5 wrong attempts, 30 second resend cooldown, 5 codes an hour per email, 5 failed sign-ins lock for 15 minutes, and a password reset for an unknown email looks identical to a real one.

## Database: Vista

Vista gives each Workspace its own isolated PostgreSQL database and handles access, migrations, readiness and recovery; the app owns its data model. Two consequences, to settle when we have Vista's connection details:
- **Direct SQL is assumed.** The ledger relies on triggers, row locks and one transaction per payout. If Vista only exposes a REST layer, money actions must become stored functions inside the database.
- **`workspace_id` is redundant inside one Vista database.** The plan keeps the column so the schema survives a move to a shared database; revisit before step 4.

## Layout: phone, tablet, desktop

`<AppFrame>` measures its own width and sets `data-layout`: phone under 640px, tablet 640-1023px, desktop 1024px and up. CSS keys off that attribute, never off the browser window, so the same screens work inside ui-hub's device previews and on a real site. Navigation is a bottom bar, an icon rail and a labelled sidebar; lists become tables (`DataTable`) from tablet up; modals replace bottom sheets.
