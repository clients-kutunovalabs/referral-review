# Security

Frontend code cannot be made uncopyable. Protection is server-side: authorisation and business rules run on the server, nothing sensitive is sent to the browser, and the database itself refuses to break the money rules.

## In place

| Area | What |
|---|---|
| Passwords | scrypt, per-password salt, parameters stored with the hash. Unknown and known emails cost the same time to check. |
| One-time codes | 6 digits, 10 minutes, only a hash stored, 5 wrong guesses lock the code (counted even though the request errors), 30 s resend, 5 codes an hour per email. Single-use step tickets. |
| Sign-in | Generic error for wrong password or unknown email; 5 failures from one address lock that email for that address for 15 minutes, and 30 an hour from all addresses lock it everywhere, so a stranger cannot keep someone locked out; a password reset signs out every device. Only the main email can log in. |
| Who is registered | Sign-up and "add an email" answer the same for a taken email as for a new one, and send no code; the screens tell the person to log in or reset. |
| Admin roles | Owner has everything. A role manager can only give out permissions they hold, cannot change their own roles, and cannot give out "Manage roles" (owner only). A user manager cannot suspend or delete admins (owner only). Nobody but the owner pays their own payout. |
| Sessions | Random token, only its hash stored, HttpOnly, SameSite=Lax, Secure with the `__Host-` prefix, one week (168 hours) of inactivity that restarts at every visit (renewed at most every 5 minutes, cookie re-issued with it), 20 per person, ended at once when a person is suspended or deleted. |
| Development quick login | `/dev` and `/dev/login` sign a tester in without a password. They work only under `next dev` (NODE_ENV=development) with `DEV_LOGIN=1`, both set by `npm run dev` alone. A built site always runs as production, so the routes can never open there whatever the environment says, and configuration refuses DEV_LOGIN anywhere but development. `APP_ENV=development` only allows http and test email for local runs of a built site; it no longer relaxes secrets, the database or DEV_LOGIN. The `localhost` check stays as an extra layer. Tested. |
| Password change | Needs the current password, counted before it is checked (5 tries per 15 minutes, so a stolen session cannot guess it), signs every other browser out and keeps this one. |
| CSRF | Cross-site writes refused (Origin must be the site); every logged-in write also needs a token bound to that session. API accepts JSON only. |
| Authorisation | Admin roles are read from the database on every admin request. Workers can only read their own tickets, claims, wallet and files. |
| Review | Nobody can review their own work, even an admin who also works tasks. |
| Money | Integer paise (bigint), no floats. Append-only ledger enforced by database triggers. Debits can never exceed the balance (checked again in the database). Locks on the user and payout rows. Reconciliation job. |
| UPI IDs | AES-256-GCM at rest; masked everywhere except the payer's payout screen; each full view is audit-logged. |
| Uploads | Type decided from the file's bytes (PNG, JPEG, WebP only), 5 MB cap counted on received bytes, random file names, never served directly: only through an access check, with `nosniff` and a sandboxing CSP. |
| Input | Strict schemas (unknown fields rejected), all SQL parameterised, ids in paths must be UUIDs, `site_url` must be https (also a database check). |
| Rate limiting | In the database, so it holds across servers. Sign-in, codes, claims, payouts, uploads, tickets, UPI views. |
| Headers | Per-request CSP with a nonce (no inline script runs without it), `X-Frame-Options: DENY`, HSTS in production, `Referrer-Policy`, `Permissions-Policy`, COOP, no public source maps, `X-Powered-By` removed. |
| AI | The request type is the allow-list (title, description, keywords, tone, language, length, style). No worker data can be passed to it. Failures are recorded and never block a claim. |
| Audit | Every admin action, in the same transaction as the action. Append-only. |
| Configuration | Production refuses to start without strong secrets, a database, https and a mail server. |
| Dependencies | Production audit clean. Next.js on the patched 15.5 line. |

## Not in place (see [WORKLOG](WORKLOG.md))

No site-wide request limit on reads (put one at the proxy; writes are limited), no breached-password check (8 characters minimum), an outside penetration test (the automated attack checks in `e2e/security.mjs` pass), UPI key rotation, account anonymisation tool, S3 storage with a separate upload domain, an audit-log viewer.

## Assumptions the deployment must keep

- `TRUST_PROXY_HOPS` matches the real number of proxies, and the proxy overwrites `X-Forwarded-For`.
- HTTPS everywhere; the app is not reachable over plain http.
- The database is not reachable from the internet; backups are encrypted.
- Sales screenshots can contain customer data: restrict the upload volume and define how long they are kept.
