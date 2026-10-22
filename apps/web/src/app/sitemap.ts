import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
/** Only the public pages. The app, the admin panel and the API are not for search engines. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE.url}/`, changeFrequency: "monthly", priority: 1 }];
}
