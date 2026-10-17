import { AuthError, type AuthPort } from "@rr/core";

export interface AuthgateConfig { url: string }

/**
 * Placeholder for the real Authgate adapter (OAuth / Supabase-Auth style: it owns sign-up, password, sessions and reset).
 * To finish it: map each AuthPort method to the matching Authgate call, turn its errors into AuthError codes,
 * and keep the session in an HttpOnly cookie. Nothing else in the repo needs to change.
 */
export function createAuthgateAuth(config: AuthgateConfig): AuthPort {
  const unavailable = async (): Promise<never> => { throw new AuthError("not_configured", `Authgate is not connected yet (${config.url || "no AUTHGATE_URL"}).`); };
  return { requestCode: unavailable, verifyCode: unavailable, setPassword: unavailable, resetPassword: unavailable, signIn: unavailable, getSession: unavailable, signOut: unavailable };
}
