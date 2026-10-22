import type { ReactNode } from "react";
import "@rr/ui/styles.css";
import "@rr/ui/fonts.css";

/** The worker app and the admin app share the full design system stylesheet. */
export default function AppsLayout({ children }: { children: ReactNode }) {
  return children;
}
