import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@rr/ui/styles.css";
import "@rr/ui/fonts.css";

export const metadata: Metadata = {
  title: "Task board", description: "Claim tasks, get reviewed, get paid.", robots: { index: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" }, appleWebApp: { capable: true, title: "Tasks", statusBarStyle: "default" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
