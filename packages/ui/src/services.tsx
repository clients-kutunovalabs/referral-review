import { createContext, useContext, type ReactNode } from "react";
import type { Services } from "@rr/core";

/** Demo-only extras. Absent in production, so no hint is ever rendered there. */
export interface DemoInfo {
  /** The one-time code every mock request uses. */
  code?: string;
  /** Shown under the sign-in form, e.g. which demo account to use. */
  signInHint?: string;
}

interface Ctx { services: Services; demo: DemoInfo }
const ServicesContext = createContext<Ctx | null>(null);

/** Hands the apps their adapters. ui-hub passes mocks; the real site passes Authgate, Vista and friends. */
export function ServicesProvider({ services, demo = {}, children }: { services: Services; demo?: DemoInfo; children: ReactNode }) {
  return <ServicesContext.Provider value={{ services, demo }}>{children}</ServicesContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("Wrap the app in <ServicesProvider services={...}>.");
  return ctx;
}
export const useServices = (): Services => useCtx().services;
export const useDemo = (): DemoInfo => useCtx().demo;
