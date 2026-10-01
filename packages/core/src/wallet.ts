import type { Paise } from "@rr/money";
import type { PayoutRequest } from "./contracts";

export interface WalletTotals {
  /** payouts an admin has paid and confirmed */
  withdrawn: Paise;
  /** payout requests waiting for an admin to pay and confirm: blocked from the balance */
  processing: Paise;
  /** earned - withdrawn - processing, never negative */
  available: Paise;
}

/** Wallet numbers are always derived, never stored. A request blocks its amount the moment it is made. */
export function walletTotals(earned: Paise, payouts: readonly PayoutRequest[]): WalletTotals {
  let withdrawn = 0n;
  let processing = 0n;
  for (const p of payouts) {
    if (p.status === "paid") withdrawn += p.amount;
    else if (p.status === "pending") processing += p.amount;
  }
  const left = earned - withdrawn - processing;
  return { withdrawn, processing, available: left > 0n ? left : 0n };
}
