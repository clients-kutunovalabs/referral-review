/**
 * Money is always integer paise held in a bigint. Never a JS number.
 * APIs send money as decimal strings of paise (e.g. "4000" = ₹40.00).
 */
export type Paise = bigint;

export const OUTCOME_PERCENTS = [100, 75, 50, 25, 0] as const;
export type OutcomePercent = (typeof OUTCOME_PERCENTS)[number];

export function isOutcomePercent(n: number): n is OutcomePercent {
  return (OUTCOME_PERCENTS as readonly number[]).includes(n);
}

/** Whole rupees to paise. Input must be an integer number of rupees. */
export function rupees(whole: number | bigint): Paise {
  if (typeof whole === "number" && !Number.isInteger(whole)) {
    throw new RangeError("rupees() takes whole rupees; use parseRupees() for text with paise");
  }
  return BigInt(whole) * 100n;
}

/** Amount credited for an outcome: reward * pct / 100, truncated (never rounds up). */
export function outcomeAmount(reward: Paise, pct: OutcomePercent): Paise {
  if (reward < 0n) throw new RangeError("reward must not be negative");
  return (reward * BigInt(pct)) / 100n;
}

/** Format paise as rupees: 4000n -> "₹40", 4050n -> "₹40.50". Groups thousands the Indian way. */
export function formatRupees(amount: Paise): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const wholeStr = groupIndian(whole.toString());
  const fracStr = frac === 0n ? "" : "." + frac.toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${wholeStr}${fracStr}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Parse "40", "40.5", "40.50" into paise without floating point. Returns null when invalid. */
export function parseRupees(input: string): Paise | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const whole = BigInt(m[1] as string);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return whole * 100n + frac;
}

/** Wire format helpers: paise as decimal string. */
export const toWire = (amount: Paise): string => amount.toString();
export function fromWire(s: string): Paise {
  if (!/^-?\d+$/.test(s)) throw new RangeError("invalid money string");
  return BigInt(s);
}

export function sum(amounts: readonly Paise[]): Paise {
  return amounts.reduce((a, b) => a + b, 0n);
}
