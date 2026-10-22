# Launching the site

This is the checklist from "code works" to "people can use it". Nothing here needs code changes; it needs accounts, secrets and a server.

## 1. What you must provide

| Need | Why | Where it goes |
|---|---|---|
| A PostgreSQL 14+ database (Vista) | All data. **Check that Vista gives a direct SQL connection string.** The ledger relies on triggers, row locks and transactions; a REST-only database cannot run this code as is. | `DATABASE_URL`, `DATABASE_SSL=1` |
| A mail server (SMTP) | The only emails sent are one-time codes (sign-up, password reset, extra email). Without it nobody can sign up. | `SMTP_URL`, `MAIL_FROM` |
| A domain with HTTPS | Cookies are `Secure`; the site refuses to start in production over http. `APP_URL` is also the address search engines see: the public page's canonical link, share image, `robots.txt` and `sitemap.xml` are built from it. | `APP_URL=https://...` |
| A server that runs Docker (or Node 22) with a **persistent disk** | Screenshots are stored on disk. | `UPLOAD_DIR` (mount a volume) |
| Two generated secrets | Sign CSRF tokens; encrypt UPI IDs. **Back up the UPI key.** Losing it makes stored UPI IDs unreadable. | `SESSION_SECRET`, `UPI_ENCRYPTION_KEY` |
| (Optional) A webhook for alerts | Posts "money records disagree", "a background job failed" and "unexpected server error" to Slack, Discord or any JSON webhook. Messages carry no personal data. | `ALERT_WEBHOOK_URL` |
| (Later) AI provider | AI-written scripts. Not connected yet: AI is on only when both are set; until then admins cannot publish AI-script tasks. | `ANTHROPIC_API_KEY`, `AI_MODEL` |
| First owner login | Created on first start if it does not exist. | `OWNER_EMAIL`, `OWNER_PASSWORD` |

Generate the secrets:

```
openssl rand -base64 48     # SESSION_SECRET
openssl rand -base64 32     # UPI_ENCRYPTION_KEY
```

Never set `DEV_LOGIN`: it is a development-only shortcut that signs anyone in without a password, and the site refuses to start in production with it on.

The full list of settings, with comments, is in [`.env.example`](../.env.example). The site checks them at start-up and refuses to run in production if a required one is missing or unsafe (console email, http URL, no database, short secret).

## 2. Run it

```
cp .env.example .env        # fill it in
docker compose up --build   # web on :3000, worker, and a local Postgres (drop the db service when using Vista)
```

Two images come from one `Dockerfile` (CI builds both on every push, starts them against a real Postgres, and runs the browser journey, the attack checks and a backup-restore test against them): `--target web` and `--target worker`. The design gallery (ui-hub) is never in either.

Without Docker:

```
pnpm install --frozen-lockfile
pnpm build:web
pnpm db:migrate && pnpm db:seed
node apps/web/.next/standalone/apps/web/server.js     # copy .next/static and public next to it first (see Dockerfile)
pnpm worker                                           # separate process: expires overdue claims, housekeeping, reconciliation
```

**The worker must be running.** Without it, claims whose timer ran out are never expired, so their slots stay taken.

## 3. Put it behind a reverse proxy

- Terminate HTTPS at the proxy (Caddy, nginx, a cloud load balancer) and forward to port 3000.
- Set `TRUST_PROXY_HOPS` to the number of proxies in front of the app (normally `1`; `0` if none). It is required in production: the site refuses to start without it. Too low and every visitor shares one rate-limit bucket; too high and a visitor can fake their address. Make sure the proxy **overwrites** `X-Forwarded-For` rather than passing the client's value through.
- Allow request bodies of at least 6 MB (screenshots).
- Serve the site on **one address only** (`APP_URL`). The site refuses writes whose origin differs, so make the proxy redirect `www.` or any alias to it.
- Add a general request rate limit here (for example 20 requests a second per address); the app limits writes, not reads.

## 4. First hour after launch

1. Open `/admin`, log in as the owner, **change the owner password** (use "Forgot password"; there is no change-password screen yet).
2. Team tab: add your staff by their sign-up email, then give them roles (Roles tab).
3. Create a test task, sign up as a worker on your phone, run one task through to a payout. This is the real rehearsal.
4. Run `pnpm reconcile` (or `docker compose run worker reconcile`). It must say `reconcile.ok`.

## 5. Run-time checks

**Monitoring (set these up before launch; 10 minutes):**
- **Uptime monitor** (UptimeRobot, Better Stack, or any): check `https://<your site>/api/health?strict=1` every minute, and alert on anything but 200. It answers 200 only when the database is reachable **and the background worker has checked in within 10 minutes**. A dead worker is silent otherwise: timed-out claims never free their slots. Plain `/api/health` (no `strict`) is for the container health check and only tests the database.
- **Alerts:** set `ALERT_WEBHOOK_URL` so a human hears about "money records disagree", "a background job failed" and "unexpected server error". Repeats of the same alert are held back for 5 minutes.
- **Logs:** the site and the worker write one JSON line per event (`level`, `event`). Keep them for at least 30 days and alert on `"level":"error"` and `reconcile.PROBLEMS`. Logs can contain error text from the database, so treat them as private.
- `reconcile.PROBLEMS` means the money records disagree: **stop paying and investigate** (see the runbook).

**Backups (set up before launch):** `ops/backup.sh` daily from cron, copy the result off the machine (`AFTER_BACKUP`), then run `ops/verify-restore.sh` once now and monthly. Details in the [RUNBOOK](RUNBOOK.md). If Vista takes backups for you, still keep the uploads folder backup, and still do the restore test.

## 6. Things that are not finished

See the "Deferred" section of [WORKLOG](WORKLOG.md). The ones that matter most before a public launch: one web server only (screenshots are on local disk); legal pages and payout tax rules need your lawyer and CA ([POLICY](POLICY.md)).
