import type { Runtime } from "@rr/server/runtime-api";

/**
 * The quick-login pages exist only in development, only when DEV_LOGIN is on, and only for a browser on this very machine
 * (a phone or laptop on the same network gets a plain 404). Configuration also refuses DEV_LOGIN in production.
 */
export function devLoginAllowed(rt: Runtime, req: Request): boolean {
  if (!rt.cfg.devLogin || rt.cfg.production || process.env.NODE_ENV === "production") return false;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export const notFound = (): Response => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
