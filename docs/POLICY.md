# Product policy (draft, to finalise before launch)

- Task script: `none | keywords | manual_pool | ai_generated`. AI receives only task title, description, keywords and the AI settings, never worker data.
- Duplicate UPI (deferred): the worker types the UPI each time and nothing is saved, so no duplicate check exists now. When UPI IDs are saved per account, a second account trying to save a UPI already linked to another account gets a warning; the admin can then freeze one or both accounts until it is fixed, or ban one or both. Decide the defaults and put them in the ToS then.
- Minimum payout, payout cadence, TDS and entity structure: decide with a CA before real money moves.
- Terms of Service and Privacy Policy (DPDP Act) need review before launch.

- Email: we send no emails except one-time verification codes: when an account is created, when an extra email is added, and when someone resets a forgotten password (a code, never a link). Workers see review results, payments and status in the app only.
- Sign-in: Authgate owns identity (sign-up, password, sessions, reset). The account's first email is verified once at sign-up. Extra emails are added and verified inside the site, one code each. Admins are invited, so the admin sign-in has no sign-up.
