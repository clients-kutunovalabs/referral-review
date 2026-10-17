/**
 * Ports: the seams where an outside system plugs in. The UI and the domain code only know these interfaces.
 * Each has a mock adapter (in-memory, used by ui-hub and tests) and a placeholder for the real one
 * (Authgate for auth, Vista for the database, an object store, an AI provider) that gets filled in when credentials arrive.
 */

/* ---------- Auth (Authgate owns identity: sign-up, password, sessions, reset) ---------- */

export type AuthErrorCode =
  | "invalid_email"
  | "email_taken"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "rate_limited"
  | "weak_password"
  | "invalid_credentials"
  | "not_configured";

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthUser { id: string; email: string; emailVerified: boolean; profile: Record<string, string> }
export interface AuthSession { user: AuthUser; expiresAt: string }

/** "signup" proves a new email once, then the user chooses a password. "reset" does the same to recover a password. */
export type CodePurpose = "signup" | "reset";
export interface CodeSent { expiresInSeconds: number; resendAfterSeconds: number }

export const PASSWORD_MIN_LENGTH = 8;
export const CODE_LENGTH = 6;

export interface AuthPort {
  /** Email a one-time code. For "signup", `profile` (name, phone, ...) is kept with the account. Unknown emails on "reset" resolve silently so accounts cannot be enumerated. */
  requestCode(email: string, purpose: CodePurpose, profile?: Record<string, string>): Promise<CodeSent>;
  /** Check the code. The returned ticket is single-use, tied to this email and purpose, and only good for the next step. */
  verifyCode(email: string, code: string, purpose: CodePurpose): Promise<{ ticket: string }>;
  /** Finish sign-up: set the first password. Signs the user in. */
  setPassword(ticket: string, password: string): Promise<AuthSession>;
  /** Finish a reset: set a new password. Signs the user in. */
  resetPassword(ticket: string, password: string): Promise<AuthSession>;
  signIn(email: string, password: string): Promise<AuthSession>;
  getSession(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
}

/* ---------- Extra emails (identities): verified by the site itself, not by Authgate ---------- */

export interface EmailVerificationPort {
  send(email: string): Promise<CodeSent>;
  verify(email: string, code: string): Promise<void>;
}

/* ---------- Outgoing email ---------- */

export type EmailKind = "signup_code" | "reset_code" | "identity_code";
export interface OutgoingEmail { to: string; kind: EmailKind; code: string; expiresInMinutes: number }
/** Starts as Authgate's default sender; swapped for a real sender once one is configured. */
export interface EmailSenderPort { send(message: OutgoingEmail): Promise<void> }

/* ---------- File storage (private bucket, short-lived signed URLs) ---------- */

export type UploadKind = "proof" | "payment_proof" | "ticket_attachment";
export const UPLOAD_RULES = { maxBytes: 5 * 1024 * 1024, contentTypes: ["image/png", "image/jpeg", "image/webp"] as readonly string[] };

export interface StoragePort {
  /** Rejects wrong types and oversize files itself; the browser check is only a convenience. */
  put(input: { kind: UploadKind; contentType: string; bytes: Uint8Array }): Promise<{ key: string }>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

/* ---------- AI script generation ---------- */

/** The complete allow-list of what may reach the AI. There is deliberately no field for worker data. */
export interface ScriptRequest {
  title: string;
  description: string;
  keywords: string[];
  tone: "friendly" | "professional" | "persuasive" | "casual";
  language: string;
  minWords: number;
  maxWords: number;
  style: "cold_message" | "call_script" | "email";
}
export interface AiPort { generateScript(input: ScriptRequest): Promise<string> }

/** Everything the apps need from the outside world. */
export interface Services {
  auth: AuthPort;
  emailVerification: EmailVerificationPort;
  storage: StoragePort;
  ai: AiPort;
}
