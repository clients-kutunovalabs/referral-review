# @rr/config

`loadConfig()` reads and checks the environment once, with clear errors. In production it refuses to start without strong secrets, a database, an https `APP_URL` and a mail server. In development everything has a safe fallback so `pnpm dev:web` runs with no setup. See `.env.example`.
