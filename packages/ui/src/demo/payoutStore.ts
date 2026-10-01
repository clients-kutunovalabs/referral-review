/**
 * Demo-only shared payouts for the demo user, so the user app and the admin app in ui-hub see the same requests:
 * a request made on the user side shows up in the admin Payouts list, and when the admin marks it paid the
 * user's Processing amount moves into Total withdrawn. The real apps replace this with API calls.
 */
import { useSyncExternalStore } from "react";
import { fixtures, type PayoutRequest } from "@rr/core";

const seed = (): PayoutRequest[] => fixtures.payoutScenarios.processing.map((p) => ({ ...p }));
let payouts: PayoutRequest[] = seed();
let nextId = 100;
const listeners = new Set<() => void>();
const emit = () => { payouts = [...payouts]; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function usePayouts(): PayoutRequest[] {
  return useSyncExternalStore(subscribe, () => payouts, () => payouts);
}

export function maskUpi(upi: string): string {
  const [name = "", bank = ""] = upi.split("@");
  return `${name.slice(0, 3)}••@${bank}`;
}

export function requestPayout(amount: bigint, upi: string) {
  payouts = [{ id: `p${nextId++}`, who: "Priya S.", amount, status: "pending", upiMasked: maskUpi(upi), upiFull: upi, whenLabel: "just now", at: new Date().toISOString() }, ...payouts];
  emit();
}

/** Admin confirms a manual payment. Only a pending request can be paid. */
export function markPaid(id: string, by: string) {
  payouts = payouts.map((p) => (p.id === id && p.status === "pending" ? { ...p, status: "paid", paidBy: by, paidAt: new Date().toISOString() } : p));
  emit();
}

export function resetPayouts() { payouts = seed(); emit(); }
