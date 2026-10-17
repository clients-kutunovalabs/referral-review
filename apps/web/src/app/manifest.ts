import type { MetadataRoute } from "next";

/** Makes the site installable to a phone's home screen. (Offline use is not built: every screen needs the server.) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Task board",
    short_name: "Tasks",
    description: "Claim tasks, get reviewed, get paid.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
