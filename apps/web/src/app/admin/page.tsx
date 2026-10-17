import SiteLoader from "@/components/SiteLoader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin panel" };
export default function Admin() { return <SiteLoader kind="admin" />; }
