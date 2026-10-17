import SiteLoader from "@/components/SiteLoader";

export const dynamic = "force-dynamic"; // a fresh CSP nonce on every request
export default function Home() { return <SiteLoader kind="user" />; }
