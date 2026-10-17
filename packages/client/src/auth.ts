import {
  ApiError, AuthError, type AuthErrorCode, type AuthPort, type AuthSession, type CodeSent, type EmailVerificationPort
} from "@rr/core";
import type { Http } from "./http";

const AUTH_CODES = new Set<string>([
  "invalid_email", "email_taken", "invalid_code", "code_expired", "too_many_attempts", "rate_limited", "weak_password", "invalid_credentials", "suspended"
]);

/** Sign-in screens speak AuthError; anything the server says that is not about sign-in becomes a plain, safe message. */
async function asAuth<T>(p: Promise<T>): Promise<T> {
  try { return await p; }
  catch (e) {
    if (e instanceof ApiError) throw new AuthError((AUTH_CODES.has(e.code) ? e.code : "internal") as AuthErrorCode, e.message, e.retryAfterSeconds);
    throw new AuthError("internal", "We could not reach the server. Check your connection and try again.");
  }
}

interface SessionBody { session: AuthSession | null; csrf: string | null }

export function createHttpAuth(http: Http): AuthPort {
  const start = async (path: string, body: unknown): Promise<AuthSession> => {
    const r = await http.request<SessionBody>("POST", path, { body });
    http.setCsrf(r.csrf);
    if (!r.session) throw new AuthError("internal", "Sign-in did not complete. Please try again.");
    return r.session;
  };
  return {
    requestCode: (email, purpose, profile) => asAuth(http.request<{ sent: CodeSent }>("POST", "/api/auth/request-code", { body: { email, purpose, ...(profile ? { profile } : {}) } }).then((r) => r.sent)),
    verifyCode: (email, code, purpose) => asAuth(http.request<{ ticket: string }>("POST", "/api/auth/verify-code", { body: { email, code, purpose } })),
    setPassword: (ticket, password) => asAuth(start("/api/auth/set-password", { ticket, password })),
    resetPassword: (ticket, password) => asAuth(start("/api/auth/reset-password", { ticket, password })),
    signIn: (email, password) => asAuth(start("/api/auth/sign-in", { email, password })),
    async getSession() {
      const r = await asAuth(http.request<SessionBody>("GET", "/api/session"));
      http.setCsrf(r.csrf);
      return r.session;
    },
    async signOut() {
      await asAuth(http.request("POST", "/api/auth/sign-out"));
      http.setCsrf(null);
    }
  };
}

export function createHttpEmailVerification(http: Http): EmailVerificationPort {
  return { send: (email) => asAuth(http.request<{ sent: CodeSent }>("POST", "/api/identities/send-code", { body: { email } }).then((r) => r.sent)) };
}
