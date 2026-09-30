# Architecture

- pnpm monorepo, TypeScript strict. UI: React. Backend (later): Next.js route handlers + Node services, Postgres, Drizzle.
- `packages/ui` owns all visuals. `apps/ui-hub` renders them with mock data from `packages/core` fixtures. `apps/web` will render the same components with real data.
- `packages/core` contracts define the domain types the UI consumed; the backend implements exactly these.
- Workspace-ready: every domain table gets `workspace_id` from day one (single seeded workspace for now; isolation/RLS later).
- Claim uniqueness: `(identity_id, template_id)`. One login owns several identities (emails) and one wallet; ledger rows carry `identity_id`.
- Production excludes ui-hub. The production image builds only `apps/web` and `apps/worker`.
