"use client";

import dynamic from "next/dynamic";

// The app measures its own width to pick phone, tablet or desktop, so it renders in the browser only: no wrong-layout flash.
const Site = dynamic(() => import("./Site"), { ssr: false, loading: () => <div className="site-root"><div className="empty" role="status">Loading…</div></div> });
export default function SiteLoader({ kind }: { kind: "user" | "admin" }) { return <Site kind={kind} />; }
