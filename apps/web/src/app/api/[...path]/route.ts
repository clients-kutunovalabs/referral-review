import { boot } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request): Promise<Response> {
  try {
    return await (await boot()).api(req);
  } catch (err) {
    // Start-up failed (bad configuration, database unreachable). Say so plainly; details go to the log, not the browser.
    console.error("[boot] could not start:", err);
    return new Response(JSON.stringify({ error: { code: "internal", message: "The service is starting up or misconfigured. Please try again shortly." } }),
      { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "10" } });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
