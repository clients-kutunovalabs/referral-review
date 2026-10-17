import { NextResponse, type NextRequest } from "next/server";

/**
 * A fresh Content-Security-Policy for every page request. Scripts run only if they carry this request's nonce,
 * so an injected <script> cannot execute. Next reads the nonce from the request header and stamps its own scripts.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React style attributes
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

// Pages only: the API and static files do not need it.
export const config = { matcher: [{ source: "/((?!api|_next/static|_next/image|fonts|icons|favicon.ico|manifest.webmanifest|icon.svg).*)" }] };
