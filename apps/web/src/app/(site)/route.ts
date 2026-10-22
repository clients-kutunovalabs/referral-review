import { landingHtml } from "@/lib/landing";

export const dynamic = "force-dynamic"; // the CSP nonce is per request
export const runtime = "nodejs";

/** The public landing page at "/". Finished HTML; see lib/landing.ts for why it is not a Next page. */
export function GET(req: Request): Response {
  const nonce = req.headers.get("x-nonce") ?? "";
  return new Response(landingHtml(nonce), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "index, follow" }
  });
}
