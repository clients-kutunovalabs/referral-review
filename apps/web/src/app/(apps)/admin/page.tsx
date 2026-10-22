import type { Metadata } from "next";
import SiteLoader from "@/components/SiteLoader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin panel", robots: { index: false, follow: false } };
export default function Admin() { return <SiteLoader kind="admin" />; }
