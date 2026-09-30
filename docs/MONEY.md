# Money rules

1. Amounts are `bigint` paise. Never `number`, never floats. `packages/money` is the only place that formats, parses or computes money (ESLint bans `Math.round/floor/ceil` and `parseFloat` there).
2. Outcome credit = `reward * pct / 100` truncated, pct in {100, 75, 50, 25, 0}.
3. Wallet balance is always computed from the append-only ledger (per identity and total). No balance column.
4. Available to withdraw = credits - debits - amount held by pending payout requests.
5. One credit per submission, one payment per payout request (unique constraints). Debits are inserted under a row lock that re-checks the balance.
6. A payment record = debit + `payout_payments` row with `paid_by` and a required payment-proof screenshot, in one transaction.
7. Users are never hard-deleted. Suspended/deleted users keep every record; financial FKs are `ON DELETE RESTRICT`.
8. API wire format: paise as decimal strings.
