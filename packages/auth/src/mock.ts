import {
  AuthError, OTP_RULES, PASSWORD_MIN_LENGTH,
  type AuthPort, type AuthSession, type CodePurpose, type EmailSenderPort, type EmailVerificationPort, type OutgoingEmail
} from "@rr/core";
import { OtpStore, type OtpOptions } from "./otp";

/** In-memory adapters for ui-hub and tests. Passwords are held in the clear here; the real adapter never sees one. */

const EMAIL = /^\S+@\S+\.\S+$/;
const normalise = (email: string) => email.trim().toLowerCase();
const SESSION_MS = 7 * 24 * 3_600_000;
const SIGN_IN = { maxFailures: 5, lockMs: 15 * 60_000 };

export interface InMemoryOutbox extends EmailSenderPort { sent: OutgoingEmail[] }
/** Records every email instead of sending it. */
export function createOutbox(): InMemoryOutbox {
  const sent: OutgoingEmail[] = [];
  return { sent, async send(message) { sent.push(message); } };
}

export interface MockAuthOptions extends OtpOptions {
  sender?: EmailSenderPort;
  users?: { email: string; password: string; profile?: Record<string, string> }[];
}

interface Account { id: string; email: string; password: string; profile: Record<string, string> }
interface Ticket { email: string; purpose: CodePurpose; expiresAt: number }

export function createMockAuth(opts: MockAuthOptions = {}): AuthPort {
  const now = opts.now ?? Date.now;
  const sender = opts.sender ?? createOutbox();
  const otp = new OtpStore(opts);
  const accounts = new Map<string, Account>();
  const profiles = new Map<string, Record<string, string>>();
  const tickets = new Map<string, Ticket>();
  const failures = new Map<string, { count: number; lockedUntil: number }>();
  let session: AuthSession | null = null;
  let seq = 0;

  for (const u of opts.users ?? []) {
    const email = normalise(u.email);
    accounts.set(email, { id: `usr_${++seq}`, email, password: u.password, profile: u.profile ?? {} });
  }

  const keyOf = (email: string, purpose: CodePurpose) => `${purpose}:${email}`;
  const open = (a: Account): AuthSession => {
    session = { user: { id: a.id, email: a.email, emailVerified: true, profile: a.profile }, expiresAt: new Date(now() + SESSION_MS).toISOString() };
    return session;
  };
  function takeTicket(ticket: string, purpose: CodePurpose, password: string): Ticket {
    const t = tickets.get(ticket);
    if (!t || t.purpose !== purpose || now() >= t.expiresAt) throw new AuthError("invalid_code", "This step has expired. Start again.");
    if (password.length < PASSWORD_MIN_LENGTH) throw new AuthError("weak_password", `Password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
    tickets.delete(ticket);
    return t;
  }

  return {
    async requestCode(rawEmail, purpose, profile) {
      const email = normalise(rawEmail);
      if (!EMAIL.test(email)) throw new AuthError("invalid_email", "Enter a valid email address.");
      const exists = accounts.has(email);
      // Same answer whether or not the email has an account: sign-up sends a code only to a new email, reset only to a known one.
      const { sent, code } = otp.issue(keyOf(email, purpose), purpose === "signup" ? !exists : exists);
      if (purpose === "signup") profiles.set(email, profile ?? {});
      if (code) await sender.send({ to: email, kind: purpose === "signup" ? "signup_code" : "reset_code", code, expiresInMinutes: OTP_RULES.ttlMs / 60_000 });
      return sent;
    },

    async verifyCode(rawEmail, code, purpose) {
      const email = normalise(rawEmail);
      otp.check(keyOf(email, purpose), code);
      const ticket = `tkt_${++seq}_${Math.random().toString(36).slice(2)}`;
      tickets.set(ticket, { email, purpose, expiresAt: now() + OTP_RULES.ttlMs });
      return { ticket };
    },

    async setPassword(ticket, password) {
      const t = takeTicket(ticket, "signup", password);
      if (accounts.has(t.email)) throw new AuthError("email_taken", "An account with this email already exists. Log in instead.");
      const a: Account = { id: `usr_${++seq}`, email: t.email, password, profile: profiles.get(t.email) ?? {} };
      accounts.set(t.email, a);
      profiles.delete(t.email);
      return open(a);
    },

    async resetPassword(ticket, password) {
      const t = takeTicket(ticket, "reset", password);
      const a = accounts.get(t.email);
      if (!a) throw new AuthError("invalid_code", "This step has expired. Start again.");
      a.password = password;
      failures.delete(t.email);
      return open(a);
    },

    async signIn(rawEmail, password) {
      const email = normalise(rawEmail);
      const f = failures.get(email) ?? { count: 0, lockedUntil: 0 };
      if (now() < f.lockedUntil) throw new AuthError("rate_limited", "Too many failed attempts. Try again later.", Math.ceil((f.lockedUntil - now()) / 1000));
      const a = accounts.get(email);
      if (!a || a.password !== password) {
        f.count += 1;
        if (f.count >= SIGN_IN.maxFailures) { f.count = 0; f.lockedUntil = now() + SIGN_IN.lockMs; }
        failures.set(email, f);
        throw new AuthError("invalid_credentials", "Email or password is incorrect.");
      }
      failures.delete(email);
      return open(a);
    },

    async getSession() { return session && Date.parse(session.expiresAt) > now() ? session : null; },
    async signOut() { session = null; }
  };
}

/** Extra emails on one account: sends the one-time code. `isTaken` lets the data layer veto an email another account already holds. */
export function createMockEmailVerification(opts: OtpOptions & { sender?: EmailSenderPort; isTaken?: (email: string) => boolean } = {}): EmailVerificationPort & { check: (email: string, code: string) => void } {
  const sender = opts.sender ?? createOutbox();
  const otp = new OtpStore(opts);
  return {
    async send(rawEmail) {
      const email = normalise(rawEmail);
      if (!EMAIL.test(email)) throw new AuthError("invalid_email", "Enter a valid email address.");
      // An email another account holds gets the same answer but no code, so it can never be added.
      const { sent, code } = otp.issue(`identity:${email}`, !opts.isTaken?.(email));
      if (code) await sender.send({ to: email, kind: "identity_code", code, expiresInMinutes: OTP_RULES.ttlMs / 60_000 });
      return sent;
    },
    /** What UserApi.addIdentity does with the code on the server. Exposed so the mock API can do the same. */
    check(rawEmail, code) { otp.check(`identity:${normalise(rawEmail)}`, code); }
  };
}
