import { AuthError, CODE_LENGTH, OTP_RULES, type CodeSent } from "@rr/core";

export interface OtpOptions {
  now?: () => number;
  /** Mock/demo only: every code is this value, so a tester never needs an inbox. */
  fixedCode?: string;
}

interface Pending { code: string; expiresAt: number; attempts: number }

export function randomCode(): string {
  const digits = new Uint32Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(digits);
  return Array.from(digits, (d) => String(d % 10)).join("");
}

export class OtpStore {
  private pending = new Map<string, Pending>();
  private requests = new Map<string, number[]>();
  private now: () => number;
  private fixedCode: string | undefined;

  constructor(opts: OtpOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.fixedCode = opts.fixedCode;
  }

  /** Applies the cooldown and hourly limit, then (when `deliver` is true) creates a code. Unknown emails still count toward limits so timing reveals nothing. */
  issue(key: string, deliver = true): { sent: CodeSent; code: string | null } {
    const t = this.now();
    const recent = (this.requests.get(key) ?? []).filter((at) => t - at < 3_600_000);
    const last = recent[recent.length - 1];
    if (last !== undefined && t - last < OTP_RULES.resendMs) {
      throw new AuthError("rate_limited", "Wait a moment before asking for another code.", Math.ceil((OTP_RULES.resendMs - (t - last)) / 1000));
    }
    if (recent.length >= OTP_RULES.maxRequestsPerHour) {
      const first = recent[0] as number;
      throw new AuthError("rate_limited", "Too many codes requested. Try again later.", Math.ceil((3_600_000 - (t - first)) / 1000));
    }
    this.requests.set(key, [...recent, t]);
    const sent: CodeSent = { expiresInSeconds: OTP_RULES.ttlMs / 1000, resendAfterSeconds: OTP_RULES.resendMs / 1000 };
    if (!deliver) {
      this.pending.delete(key);
      return { sent, code: null };
    }
    const code = this.fixedCode ?? randomCode();
    this.pending.set(key, { code, expiresAt: t + OTP_RULES.ttlMs, attempts: 0 });
    return { sent, code };
  }

  /** Throws unless `code` is the live code for `key`. A correct code is consumed. */
  check(key: string, code: string): void {
    const p = this.pending.get(key);
    if (!p) throw new AuthError("invalid_code", "That code is not valid. Request a new one.");
    if (p.attempts >= OTP_RULES.maxWrongAttempts) throw new AuthError("too_many_attempts", "Too many wrong codes. Request a new code.");
    if (this.now() >= p.expiresAt) {
      this.pending.delete(key);
      throw new AuthError("code_expired", "That code has expired. Request a new one.");
    }
    if (code !== p.code) {
      p.attempts += 1;
      const left = OTP_RULES.maxWrongAttempts - p.attempts;
      if (left <= 0) throw new AuthError("too_many_attempts", "Too many wrong codes. Request a new code.");
      throw new AuthError("invalid_code", `That code is wrong. ${left} attempt${left === 1 ? "" : "s"} left.`);
    }
    this.pending.delete(key);
  }
}
