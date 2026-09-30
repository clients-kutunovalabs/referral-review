import { describe, expect, it } from "vitest";
import { OUTCOME_PERCENTS, formatRupees, fromWire, outcomeAmount, parseRupees, rupees, sum, toWire } from "./index";

describe("outcomeAmount", () => {
  it("pays 100/75/50/25/0 percent of reward", () => {
    expect(OUTCOME_PERCENTS.map((p) => outcomeAmount(rupees(40), p))).toEqual([4000n, 3000n, 2000n, 1000n, 0n]);
  });
  it("truncates instead of rounding up", () => {
    expect(outcomeAmount(101n, 75)).toBe(75n); // 75.75 -> 75
    expect(outcomeAmount(1n, 50)).toBe(0n);
  });
  it("never exceeds the reward or goes negative", () => {
    for (let r = 0n; r < 500n; r++) {
      for (const p of OUTCOME_PERCENTS) {
        const a = outcomeAmount(r, p);
        expect(a >= 0n && a <= r).toBe(true);
      }
    }
  });
});

describe("formatting and parsing", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatRupees(4000n)).toBe("₹40");
    expect(formatRupees(4050n)).toBe("₹40.50");
    expect(formatRupees(123456700n)).toBe("₹12,34,567");
    expect(formatRupees(-2500n)).toBe("-₹25");
  });
  it("parses without floats", () => {
    expect(parseRupees("40")).toBe(4000n);
    expect(parseRupees("40.5")).toBe(4050n);
    expect(parseRupees("0.07")).toBe(7n);
    expect(parseRupees("40.555")).toBeNull();
    expect(parseRupees("-1")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
  });
  it("round-trips the wire format", () => {
    expect(fromWire(toWire(123n))).toBe(123n);
    expect(() => fromWire("1.5")).toThrow();
  });
  it("adds exactly", () => {
    expect(sum([10n, 20n, 30n])).toBe(60n);
  });
  it("rejects fractional rupees in rupees()", () => {
    expect(() => rupees(0.1 + 0.2)).toThrow();
  });
});
