import { errorName, errorText, logEvent } from "../log";
import { ApiError } from "@rr/core";
import type { Ctx } from "../ctx";
import { secureCookies } from "../ctx";

/** bigint (money) travels as a decimal string of paise, as docs/MONEY.md says. */
export const toJson = (data: unknown): string => JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin"
};

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(toJson(data), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...init.headers }
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) } },
      { status: err.status, headers: err.retryAfterSeconds ? { "retry-after": String(err.retryAfterSeconds) } : {} });
  }
  logEvent("error", "api.unexpected_error", { error: errorName(err), message: errorText(err) });
  return json({ error: { code: "internal", message: "Something went wrong on our side. Please try again." } }, { status: 500 });
}

export const cookieName = (ctx: Ctx): string => (secureCookies(ctx.cfg) ? "__Host-rr_session" : "rr_session");

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(ctx: Ctx, token: string, expiresAt: Date): string {
  const maxAge = Math.max(Math.floor((expiresAt.getTime() - ctx.now().getTime()) / 1000), 0);
  return `${cookieName(ctx)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies(ctx.cfg) ? "; Secure" : ""}`;
}
export const clearCookie = (ctx: Ctx): string => `${cookieName(ctx)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(ctx.cfg) ? "; Secure" : ""}`;

/**
 * The caller's address. Behind `hops` trusted proxies the real client is the entry `hops` places from the right of
 * X-Forwarded-For (each proxy appends the address it saw); anything further left can be forged by the client.
 */
export function clientIp(req: Request, hops: number): string {
  if (hops <= 0) return "unknown";
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - hops] ?? parts[0] ?? "unknown";
}

/**
 * Reads the body but stops the moment it passes `max` bytes. Content-Length is only a hint a client can omit or lie about
 * (a chunked body has none), so the limit is enforced on the bytes actually received.
 */
export async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new ApiError("bad_request", "That request is too large.", 413);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new ApiError("bad_request", "That request is too large.", 413); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Reads a JSON body of at most `max` bytes. */
export async function readJson(req: Request, max = 100_000): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ApiError("bad_request", "Send JSON.", 415);
  const text = new TextDecoder().decode(await readCapped(req, max));
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError("bad_request", "That request is not valid JSON.", 400); }
}
