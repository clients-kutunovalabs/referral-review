import type { Runtime } from "@rr/server/runtime-api";

/**
 * The quick-login pages exist only under `next dev` (NODE_ENV=development; a built site always runs as production, so they can
 * never open there whatever the environment says), only when DEV_LOGIN is on (configuration refuses it anywhere else), and,
 * as an extra layer, only for a browser on this machine (anything else gets a plain 404).
 */
export function devLoginAllowed(rt: Runtime, req: Request): boolean {
  if (process.env.NODE_ENV !== "development" || !rt.cfg.devLogin || rt.cfg.production) return false;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export const notFound = (): Response => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
