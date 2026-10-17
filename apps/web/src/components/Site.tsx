"use client";

import { useMemo } from "react";
import { createHttpServices } from "@rr/client";
import { AdminApp, AppFrame, ServicesProvider, UserApp } from "@rr/ui";

/** The browser side: the same screens as ui-hub, talking to this site's own /api. */
export default function Site({ kind }: { kind: "user" | "admin" }) {
  const services = useMemo(() => createHttpServices(), []);
  return (
    <ServicesProvider services={services}>
      <div className="site-root"><AppFrame>{kind === "admin" ? <AdminApp syncUrl /> : <UserApp syncUrl />}</AppFrame></div>
    </ServicesProvider>
  );
}
