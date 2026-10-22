import type { Metadata } from "next";
import SiteLoader from "@/components/SiteLoader";

export const dynamic = "force-dynamic"; // a fresh CSP nonce on every request
export const metadata: Metadata = { title: "Your tasks", robots: { index: false, follow: false } };
export default function WorkerApp() { return <SiteLoader kind="user" />; }
