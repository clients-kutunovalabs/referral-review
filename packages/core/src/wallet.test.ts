import { describe, expect, it } from "vitest";
import { rupees } from "@rr/money";
import { walletTotals } from "./wallet";
import type { PayoutRequest } from "./contracts";

const p = (id: string, amount: bigint, status: PayoutRequest["status"]): PayoutRequest => ({
  id, who: "You", amount, status, upiMasked: "pri••@okhdfc", upiFull: "priya@okhdfc", whenLabel: ""
});
const earned = rupees(420);

describe("walletTotals", () => {
  it("no payouts: everything is withdrawable", () => {
    expect(walletTotals(earned, [])).toEqual({ withdrawn: 0n, processing: 0n, available: rupees(420) });
  });
  it("a request in processing is blocked at once and is not withdrawn yet", () => {
    expect(walletTotals(earned, [p("a", rupees(100), "pending")])).toEqual({ withdrawn: 0n, processing: rupees(100), available: rupees(320) });
  });
  it("once paid, the processing amount moves into withdrawn and available does not change", () => {
    const before = walletTotals(earned, [p("a", rupees(100), "pending"), p("b", rupees(250), "paid")]);
    const after = walletTotals(earned, [p("a", rupees(100), "paid"), p("b", rupees(250), "paid")]);
    expect(before).toEqual({ withdrawn: rupees(250), processing: rupees(100), available: rupees(70) });
    expect(after).toEqual({ withdrawn: rupees(350), processing: 0n, available: rupees(70) });
  });
  it("earned = withdrawn + processing + available", () => {
    const t = walletTotals(earned, [p("a", rupees(100), "pending"), p("b", rupees(250), "paid")]);
    expect(t.withdrawn + t.processing + t.available).toBe(earned);
  });
  it("never goes negative", () => {
    expect(walletTotals(rupees(50), [p("a", rupees(100), "pending")]).available).toBe(0n);
  });
});
