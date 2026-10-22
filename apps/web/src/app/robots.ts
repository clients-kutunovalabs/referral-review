import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic"; // the address comes from APP_URL at run time, not at build time
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/llms.txt"], disallow: ["/app", "/admin", "/api/", "/dev"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url
  };
}
