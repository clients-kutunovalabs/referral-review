# Product policy (draft, to finalise before launch)

- Task script: `none | keywords | manual_pool | ai_generated`. AI receives only task title, description, keywords and the AI settings, never worker data.
- Payouts: the worker types the UPI ID each time (nothing is saved as a payment method). **One UPI ID belongs to one worker.** It is refused while another worker has a request waiting on it, and once it has been paid to someone else. The worker sees only "This UPI ID can't be used. Check it and try again, or contact support"; they are never told whose it is. A payment links the ID to that worker; a rejected request does not. A worker who lost their old account asks through a support ticket, and an admin with the payments permission releases the ID (logged).
- A payer can **reject** a pending request with a reason (for example the UPI ID is invalid). The worker sees the reason, the held amount is free again and they can request again. Rejected and paid are final. Money already sent cannot be taken back, and nobody's balance can go below zero.
- Minimum payout, payout cadence, TDS and entity structure: decide with a CA before real money moves.
- Terms of Service and Privacy Policy (DPDP Act) need review before launch.

- Email: we send no emails except one-time verification codes: when an account is created, when an extra email is added, and when someone resets a forgotten password (a code, never a link). Workers see review results, payments and status in the app only.
- Sign-in: the built-in provider owns identity today (sign-up, password, sessions, reset); Authgate will replace it behind the same server interface once its API is available. A session ends after **one week (168 hours) without a visit**, and every visit restarts that week, with no upper limit. The account's first email is verified once at sign-up. Extra emails are added and verified inside the site, one code each. Admins are invited, so the admin sign-in has no sign-up.
