import { devLogin } from "@rr/server/runtime-api";
import { boot } from "@/lib/server";
import { devLoginAllowed, notFound } from "@/lib/devguard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Development only: /dev/login?as=worker or ?as=admin signs you in as a demo account and opens the right app. */
export async function GET(req: Request): Promise<Response> {
  const { rt } = await boot();
  if (!devLoginAllowed(rt, req)) return notFound();
  const as = new URL(req.url).searchParams.get("as") === "admin" ? "admin" : "worker";
  const { cookie, location } = await devLogin(rt.ctx, as);
  return new Response(null, { status: 303, headers: { location, "set-cookie": cookie, "cache-control": "no-store" } });
}
