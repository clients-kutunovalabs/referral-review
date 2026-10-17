# Work log

What was built, what went wrong and how it was fixed, and what is deliberately not done. Written so that nothing is hidden: if it is not listed under "Done", assume it is not done.

## 1. Done

### Screens and layouts (phone, tablet, desktop)
- Universal sign-in screens: log in, create account (email, one-time code, password), forgot password, reset. Admin sign-in has no sign-up.
- Phone, tablet and desktop layouts for both apps. The layout follows the width of the app frame, not the browser window. Desktop admin follows the reference screenshot: sidebar with count badges, page header with the action on the right, full-width tables.
- Design-system page documents the new password field, table and breakpoints.

### Database (`packages/db`)
- One migration, `0001_init.sql` (plain SQL, so Vista or any Postgres tooling can run it): workspaces, users, identities (extra emails), credentials, sessions, one-time codes, rate limits, roles and permissions, tasks, scripts and the script bag, claims, submissions, reviews, payouts, payments, ledger, tickets, files, audit log.
- Integrity enforced **by the database**, so a bug in the app cannot break it: the ledger, reviews, payments and audit log cannot be updated, deleted or truncated; one credit per submission; one payment per payout; one pending payout per user; one live claim per email and task; a ledger debit can never exceed the balance; financial rows can never be orphaned.
- Two adapters behind one interface: real PostgreSQL (`pg`) and PGlite (Postgres in WebAssembly, for zero-install development). A migration runner with an advisory lock (safe if two instances start together).
- Every database test runs on both engines.

### Backend (`packages/server`)
- **Tasks**: create with full server-side validation (every rule the form has), pause, resume, remove (voids claims not yet submitted), derived status (active, closing soon, closed, paused, removed).
- **Claims**: row-locked so slots can never be over-claimed; one live claim per email; per-account cap across all of a person's emails; reward fixed at claim time; timer; expiry job that frees the slot.
- **Scripts**: balanced random bag (10 scripts, 100 workers: each used exactly 10 times), scripts added later are mixed into what is still waiting, AI scripts written after the claim is saved (a slow provider never blocks others), failure recorded with a retry button, only allow-listed task fields ever reach the AI.
- **Submissions and reviews**: screenshot upload validated by real file bytes, keyword check as a reviewer aid, review decisions of 100/75/50/25/0 with a mandatory note, one decision per submission, credit written in the same transaction.
- **Money**: balance always computed from the ledger; payout request holds the amount at once; payment needs a screenshot, records who paid, writes the debit in one transaction; UPI IDs encrypted at rest (AES-256-GCM) and shown in full only on the payer screen, where every view is audit-logged; reconciliation recomputes every wallet and reports any mismatch.
- **People**: built-in sign-in (below), extra emails with their own one-time code, user suspend/reinstate/soft-delete (signs them out; records are never removed), roles, team and permissions checked against the database on every admin request, audit log for every admin action.
- **Support**: tickets with one image, chat, assignment, resolve (chat becomes read-only, enforced on the server too).
- **Housekeeping**: purge of stale sessions, codes, tickets, rate-limit rows.

### Sign-in and security
- Built-in provider (so the site is launchable without Authgate): scrypt password hashes, one-time codes stored only as hashes (6 digits, 10 minutes, 5 wrong attempts, 30-second resend, 5 codes an hour), single-use step tickets, sign-in lockout after 5 failures, identical answers for unknown and known emails on reset, a reset signs out every device.
- Sessions: random token, only its hash stored, HttpOnly + SameSite=Lax + Secure (`__Host-` prefix), one week (168 hours) of inactivity that restarts at every visit, at most 20 per person, ended at once when someone is suspended.
- CSRF: cross-site writes are refused outright (Origin check) and every logged-in write needs a token tied to that session.
- Rate limits kept in the database (so they hold across several servers) on sign-in, codes, claims, payouts, uploads, tickets.
- Per-request Content-Security-Policy with a fresh nonce, `X-Frame-Options: DENY`, HSTS, no public source maps, request bodies capped on the bytes actually received.
- Files are never served directly: only through an access check, as sandboxed images.

### API (`/api`)
- 51 endpoints, validated with strict schemas (unknown fields rejected), money as strings of paise, one error shape. Full list in `packages/server/src/http/handler.ts`.

### Web app, worker and deployment
- Next.js site serving the same screens as the design gallery, talking to the real API. Fonts self-hosted. Installable to a phone home screen (manifest and icons).
- Worker: expires overdue claims every minute, housekeeping hourly, reconciliation every 6 hours; one-off commands `migrate`, `seed`, `expire`, `purge`, `reconcile`.
- Environment checked at start-up with clear errors; production refuses unsafe settings.
- Dockerfile (web and worker images; the design gallery is excluded), docker-compose, `.env.example`, CI with a real PostgreSQL service.
- `docs/DEPLOY.md` launch guide.

### Verification
- **360 automated tests**, all passing: money 8, config 7, database 19, core 21, AI 4, auth 15, storage 6, client 9, UI 67, server 201 (each database test on both PGlite and real PostgreSQL), worker 3.
- Real-Postgres race tests: 50 workers claiming a 10-slot task get exactly 10; two reviewers deciding the same submission credit it once; ten simultaneous payout requests create one; two payers paying the same request pay it once.
- **Browser journey** (`pnpm e2e`, 17 steps) against the production build run on its own with the repo's dependencies hidden, so it cannot borrow anything: sign-up with a real emailed code over SMTP, publish, claim, upload, review at 75%, wallet, payout, pay with proof, support ticket with image, extra email, logout, stranger denied, all three layouts. Passes with no browser errors. The money reconciles clean afterwards.
- Dependency audit of production dependencies: no known vulnerabilities.

## 2. Issues found and solved

| # | Issue | Found by | Fix |
|---|---|---|---|
| 1 | **Next.js 14 had 2 critical and 11 high advisories** (28 in total). | `pnpm audit` | Upgraded to the patched Next 15.5 line and React 19; `postcss`, `vite` overridden; test runner upgraded. Production audit is now clean. |
| 2 | **The Docker-bound build was not relocatable**: it baked in this machine's absolute paths and did not ship the database driver, so it would have failed on first request in an image. It only appeared to work because it ran inside the repo. | Running the artifact outside the repo | Database and mail drivers are direct dependencies of the web app so they ship; PGlite is loaded lazily and natively. Proved by running the build with the repo's dependencies hidden. |
| 3 | **After an admin reviewed a submission, the worker's app did not update** until a reload, though nothing is emailed. | Browser journey | The app refreshes every 30 s, when the tab regains focus, and when moving between tabs. |
| 4 | A client could send a **chunked body with no Content-Length** and make the server buffer without limit. | Design review | Size limits are enforced on the bytes actually received. Tested. |
| 5 | A malformed id in a URL (`/api/tickets/abc`) caused a **500 and a database stack trace**. | Probing the running site | Every path id must be a UUID, otherwise a plain 404. Tested. |
| 6 | **Overdue-claim expiry was rolled back** when the submit call then returned an error (the update and the error shared a transaction). | Tests | The "too late" outcome is returned, committed, then thrown. |
| 7 | Support chat and script lists **ordered by random IDs** when two rows shared a timestamp, so "who spoke last" could be wrong. | Tests | Insertion-order columns used everywhere. |
| 8 | Zero-install development mode **failed**: the bundler breaks PGlite's WebAssembly loading. | Trying `pnpm dev:web` | PGlite is loaded natively at run time. |
| 9 | Logging out left the previous person's wallet and tasks in memory for the next person on a shared device. | Review | Loaded data is cleared the moment someone signs out. |
| 10 | Wrong one-time-code guesses would have been undone by the error that follows them, allowing unlimited guessing. | Design (built and tested to avoid it) | Code checks run in their own committed transaction; the error is thrown afterwards. |
| 11 | The plan said "one claim per email per task" for ever, but an expired claim should free the email to try again. | Plan vs UI | Partial unique index: expired and voided claims do not count. |
| 12 | The old demo stores baked in labels like "2 hours ago" and let the UI invent data. | Moving to a real API | Contracts carry timestamps; the UI formats them in the person's own time zone. |
| 13 | Admin screenshot images were unstyled and could overflow. | Real-stack screenshots | Styled. |
| 14 | Tablet table titles wrapped into a sliver. | Screenshots | A less important column is hidden on tablet. |
| 15 | On phone, the sidebar's brand and footer leaked into the bottom bar; the compact nav style leaked into desktop. | Screenshots | Hidden by default; compact style limited to phone. |
| 16 | The phone-sized layout flashed on desktop before the app measured itself. | Design | The app renders in the browser only, after measuring. |
| 17 | Seeding the owner could overwrite an existing owner's password. | Design | Seeding only creates what is missing. |
| 18 | **An admin who also has a worker account could approve their own work** (and so pay themselves). The plan waived maker-checker for payouts, not for reviews. | Security review | Nobody can review their own work; tested. Payouts keep the plan's rule. |
| 19 | **`npm run dev` did not exist**, and plain `npm install` cannot install a pnpm workspace. | User report | `npm run dev` now finds or fetches pnpm, installs once, and starts the site. `npm install` stops with a clear message instead of failing halfway. Proven from a fresh clone. |
| 20 | **A fresh checkout's dev server returned 503**: the embedded database folder was not created. | `npm run dev` | The folder is created first. Tests missed it because they use in-memory databases. |
| 21 | The gallery and UI package were tested on React 18 while production runs React 19. | Dependency review | All on React 19; full tests, build and the 17-step browser journey pass on it. |
| 22 | Test runs failed at random (`ENOTEMPTY ... .vitest-cache`): parallel packages shared one cache folder. | `pnpm check` | The shared cache is switched off for tests. Two full runs in a row pass. |
| 23 | Windows line endings could change the embedded migration text. | Review | `.gitattributes` forces LF. |
| 24 | Unused dependencies and exports (worker, client, auth, schemas, gallery). | knip | Removed. The rest of knip's list is intentional (see DEPLOY.md: `pg`, `nodemailer` are direct deps so the standalone build carries them). |

| 25 | **A payout could not be rejected**: a wrong UPI ID left the money held and the worker unable to ask again. | Money review | Payers reject with a reason (migration 0002); the hold is released, the worker sees why. Final once rejected; tested, including that the database refuses to move it back to pending. |
| 26 | **Sign-in lockout could be bypassed**: 30 parallel guesses against a limit of 5 were all processed. | Tested | The attempt is counted before the password is checked. 30 at once now get 5 tries. |
| 27 | One UPI ID could be used by any number of accounts. | Decision | One UPI ID, one worker (keyed hash, unique while pending, linked when paid, released by an admin). Generic error message; races tested on Postgres. |
| 28 | A flat 14-day session did not match the rule "a week after the last visit". | Decision | 168-hour sliding window, cookie renewed with it. |
| 29 | Authgate placeholder was on the wrong layer and unused. | Review | Deleted. The seam is the server `AuthProvider`; Authgate will implement that. |
| 30 | Testing the real screens meant signing up or in every time, with no way to see both apps quickly. | User request | Development-only quick login at `/dev` (worker and admin, sample data). Off in production by configuration, double-checked in the route, `localhost` only; tested. |
| 31 | **The Docker image could not be built**: the root `preinstall` check I added was not copied into the image, so `pnpm install` failed inside it. Nothing caught it because the image had never been built. | Building the image for the first time (a Docker daemon turned out to be usable here) | The script is now copied in the manifests layer. Both images build and run. |
| 32 | **The worker image downloaded pnpm every time it started** (needs internet at start-up; fails offline). | Running the image | pnpm is prepared once into a shared folder at build time. |
| 33 | The web image's health check always looked at port 3000, so a container on another port showed "unhealthy". | Running the image on port 3100 | The health check follows `PORT`. |
| 34 | **A dead background worker was invisible**: claims would silently stop expiring. | Review | The worker checks in every minute; `/api/health?strict=1` returns 503 when it has been quiet for 10 minutes, for an uptime monitor. |
| 35 | Accessibility scan (axe, 42 screens at phone/tablet/desktop) found 2 serious problems: a button inside a clickable card, and two buttons whose accessible name did not contain their visible text. | New scan, `e2e/a11y.mjs` | Fixed; the scan is clean. |
| 36 | No way to change a password while logged in. | Launch list | Change-password on the worker's account screen and the admin's access screen: needs the current password (5 tries per 15 minutes), signs out other browsers. |
| 37 | Errors were only `console.error` text lines; nobody would be told. | Launch list | JSON log lines, an optional alert webhook (`ALERT_WEBHOOK_URL`) for unexpected errors, failed jobs and money mismatches. |
| 38 | **`ops/backup.sh` stopped with exit code 2 when there was no uploads backup yet** (a failing `ls` under `pipefail`). My own test had always had an uploads folder. | The first run on GitHub's real CI, which has none | The prune step tolerates an empty match; retested with no uploads folder. |

Test-harness mistakes made along the way, in the open: two shell commands that killed their own shell (`pkill -f` matched itself); test data that assumed an empty database; one test that asserted nothing and was deleted.

## 3. Decisions that differ from `PLAN.md`

| Plan | What was done | Why |
|---|---|---|
| Drizzle ORM | Plain SQL migrations and typed queries | Triggers, row locks and partial indexes are written as SQL anyway; Vista handles migrations and wants SQL files; one fewer layer between the code and the money. |
| Next.js (version unspecified) | Next 15.5, React 19 | Version 14 has unpatched critical advisories. |
| Authgate for all sign-in | Built-in provider now; the Authgate adapter is not written (the placeholder was deleted) | Authgate's protocol is not known, and the site could not launch without something. Switching is one adapter. |
| Object storage with signed URLs | Local disk, served only through an access check | Needs no account; one web server only. S3 adapter is deferred. |
| `workspace_id` everywhere | Kept | Vista gives each workspace its own database, which makes the column redundant, but removing it later is easy and adding it later is not. |
| Playwright visual regression on ui-hub | Browser journey against the real site instead | Tests the product rather than pictures of mock data. |

## 4. Deferred, and why

### You must provide before launch (nothing in the code can substitute)
1. **Vista connection string**, and confirmation that it allows direct SQL. If it is REST only, the payout and ledger code needs rewriting as database functions.
2. **A mail server** (SMTP) and a sending domain with SPF/DKIM so codes reach inboxes.
3. **Hosting, domain, HTTPS, reverse proxy** and the right `TRUST_PROXY_HOPS`.
4. **Secrets**, generated and backed up. Losing the UPI key loses the stored UPI IDs.
5. **Terms of Service, Privacy Policy** (DPDP Act) and **payout tax rules** (TDS, entity structure) from your lawyer and CA.
6. **Authgate** protocol and credentials, if you still want it.
7. *Optional:* an Anthropic API key for AI scripts.

### Not built (known, and what it costs you)
| Item | Effect today |
|---|---|
| ~~Docker image never built~~ | **Done**: both images build, run as a non-root user, pass the 18-step browser journey, the attack checks and a backup-restore test. CI repeats all of it on every push. First thing to do on a machine with Docker. |
| **One web server only** | Screenshots live on local disk. Several servers need the S3 adapter. |
| **Offline use** (service worker) | The site installs to the home screen but needs a connection for every screen. |
| **Browser back button and links** | The app is one page; back leaves the site and a reload returns to the first screen. |
| **Pagination** | Lists are capped (500 rows, 200 closed). Fine for a sales-team beta, not for thousands. |
| **Cleaning up unused uploads; retention policy for screenshots** | Orphaned files accumulate on disk. |
| **Change main email screen** | The main (login) email cannot be changed from the app. Change password is done. |
| **Audit-log viewer, settings screen** (minimum payout is a database setting) | Read with SQL for now. |
| **Notification badge / unread markers** | Replies appear by refresh only. |
| **Account anonymisation tool** | Soft delete only; erasing personal details is a manual task. |
| **Sign-up reveals whether an email has an account** | Common trade-off; reset does not reveal it. |

| **Per-workspace roles, branding, row-level security** | For when this becomes a multi-tenant product. |
| **Penetration test by outside people** | Not done. Automated attack checks (`e2e/security.mjs`) and a basic load test were run; an outside test is still worth doing before a large public launch. Automated accessibility checks pass, but they find only part of the problems: try the screens with a screen reader and a keyboard. |
| **Metrics dashboards** | Logs and alerts only (no graphs). |
| **UPI key rotation** | One key; rotating needs a re-encryption script. |
| **One dev-only advisory** (`braces`, inside the design gallery's build tool, no fix published) | Never reaches production. |

## 5. Before you tell people the site is live

1. `docker compose up --build` on the real server; confirm `/api/health?strict=1` answers 200.
2. Run `pnpm e2e` (and `node e2e/security.mjs`) against it.
3. Put the real Vista, SMTP and domain in; run one task through to a real payout with your own account.
4. `pnpm reconcile` says `reconcile.ok`.
5. `ops/backup.sh` is scheduled, the copy leaves the machine, and `ops/verify-restore.sh` said `verify.ok`.
6. The uptime monitor watches `/api/health?strict=1` and `ALERT_WEBHOOK_URL` is set.
