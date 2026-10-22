# Product policy (draft, to finalise before launch)

- Task script: `none | keywords | manual_pool | ai_generated`. AI receives only task title, description, keywords and the AI settings, never worker data.
- Payouts: the worker types the UPI ID each time (nothing is saved as a payment method). Only the format is checked (name@bank). Checking that an ID really exists needs a paid payment-gateway "VPA validation" service, so for now the payer checks by hand: their UPI app shows the account holder's name before sending; if the ID is wrong they reject the request with a reason, which the worker sees.
- **One UPI ID per worker: postponed.** It comes back when UPI IDs are saved per account: then a second account trying an ID already linked to another account gets a warning, and an admin can freeze one or both accounts until it is fixed, or ban one or both. The keyed hash of each ID is already stored for that.
- Nobody marks their own payout as paid, except the owner. A suspended or deleted account's request is not paid; the payer rejects it, which releases the held amount.
- A payer can **reject** a pending request with a reason (for example the UPI ID is invalid). The worker sees the reason, the held amount is free again and they can request again. Rejected and paid are final. Money already sent cannot be taken back, and nobody's balance can go below zero.
- Minimum payout, payout cadence, TDS and entity structure: decide with a CA before real money moves.
- Terms of Service and Privacy Policy (DPDP Act) need review before launch.

- Emails per account: up to 10 (the login email included). An email already linked to an account gets the same answer as a new one but no code, so nobody can find out who is registered.
- Screenshots: a work-proof screenshot is deleted 30 days after its review decision, and a ticket image 30 days after the ticket is resolved. The records (who did what, the decision, the note, the chat text) stay; the app says the image was removed. Pending reviews and open tickets are never touched. Payment screenshots are kept for good (proof of every payout).
- Deleted accounts: every record is kept for good. The account's emails are released 30 days after deletion, so the address can sign up again as a new account.
- Email: we send no emails except one-time verification codes: when an account is created, when an extra email is added, and when someone resets a forgotten password (a code, never a link). Workers see review results, payments and status in the app only.
- Sign-in: the built-in provider owns identity today (sign-up, password, sessions, reset); Authgate will replace it behind the same server interface once its API is available. A session ends after **one week (168 hours) without a visit**, and every visit restarts that week, with no upper limit. The account's first email is verified once at sign-up. Extra emails are added and verified inside the site, one code each. Admins are invited, so the admin sign-in has no sign-up.
