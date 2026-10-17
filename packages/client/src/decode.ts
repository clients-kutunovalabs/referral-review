/** Money fields arrive as strings of paise. These are the only field names that hold money anywhere in the API. */
export const MONEY_KEYS: ReadonlySet<string> = new Set(["reward", "credited", "earned", "amount", "lifetime"]);

export function reviveMoney<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => reviveMoney(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = MONEY_KEYS.has(k) && typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : reviveMoney(v);
    return out as T;
  }
  return value as T;
}

/** bigint to a decimal string, so a request body can carry money without a float ever touching it. */
export const encodeBody = (data: unknown): string => JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
