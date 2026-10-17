import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false, // no public source maps
  output: "standalone",
  // The shared packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@rr/ui", "@rr/core", "@rr/money", "@rr/client", "@rr/server", "@rr/db", "@rr/config", "@rr/auth", "@rr/storage", "@rr/ai"],
  serverExternalPackages: ["pg", "@electric-sql/pglite", "nodemailer"],
  outputFileTracingRoot: root, // lets the standalone build include the workspace packages
  images: { unoptimized: true }, // the site uses no next/image, so the image optimizer endpoint stays off
  async headers() {
    // The Content-Security-Policy is set per request in middleware (it needs a fresh nonce).
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : [])
      ]
    }];
  }
};
