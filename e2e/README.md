# End-to-end journey

One script drives the whole product through real browsers: a worker on a phone signs up with an emailed code, an admin on a desktop publishes a task, the worker claims it, uploads a screenshot, gets reviewed, asks for a payout, the admin pays it with proof, then support tickets, an extra email, logging out, and the three layouts. It also checks the security headers, that the full UPI ID never appears in a list, and that a stranger cannot read a file.

It needs a running site and a place to catch the emails, so it runs a tiny SMTP sink next to it.

```
# 1. once: a browser for the test (any Chromium works; or set CHROMIUM_PATH)
npx playwright install chromium

# 2. a throwaway database and the mail sink
createdb rr_e2e
node e2e/smtp-sink.mjs &            # SMTP on :2525, "latest code for an address" on :2526

# 3. the site, built and started the way production runs it
export NODE_ENV=production APP_ENV=development        # APP_ENV lets a production build run over plain http locally
export APP_URL=http://localhost:3100
export DATABASE_URL=postgres://localhost/rr_e2e
export SESSION_SECRET=$(openssl rand -base64 48) UPI_ENCRYPTION_KEY=$(openssl rand -base64 32)
export EMAIL_MODE=smtp SMTP_URL=smtp://127.0.0.1:2525 TRUST_PROXY_HOPS=0
export OWNER_EMAIL=owner@example.com OWNER_NAME="Olivia Owner" OWNER_PASSWORD="owner password 123"
export UPLOAD_DIR=$(mktemp -d)
pnpm build:web && PORT=3100 node apps/web/.next/standalone/apps/web/server.js &   # copy .next/static and public beside it first

# 4. run
BASE=http://localhost:3100 pnpm e2e
```

Screenshots of key screens are written to `e2e/out/`. The script exits non-zero if any step fails, and lists any browser console errors or 5xx responses it saw.

It is safe to run repeatedly against the same database: every run uses fresh names and fresh UPI IDs (one UPI ID can belong to only one worker). It is **not** for a real site: it creates accounts and pays out fake money.


## The other two checks

Same running site (and the same mail catcher), different questions:

```
node e2e/security.mjs      # attack-minded: headers, one worker reaching another's data, admin routes as a worker, forged and malformed requests,
                           # uploads that are not images, error leaks, and script injection in a real browser. EXPECT_HSTS=1 for a production build.
node e2e/a11y.mjs          # accessibility: axe-core (WCAG 2.1 A/AA) over every screen at phone, tablet and desktop widths. Needs `npm run dev` (it uses /dev).
```

Both exit non-zero when something is wrong. Automated accessibility checks find only part of the problems; also try the screens with a keyboard and a screen reader.

CI runs the journey and the attack checks against the real Docker images on every push (see `.github/workflows/ci.yml`).
