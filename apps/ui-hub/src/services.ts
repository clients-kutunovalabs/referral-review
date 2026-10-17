import { createMockAi } from "@rr/ai";
import { createMockAuth, createMockEmailVerification } from "@rr/auth";
import { createMockStorage } from "@rr/storage";
import type { Services } from "@rr/core";
import type { DemoInfo } from "@rr/ui";

/** ui-hub runs entirely on mock adapters. The real site swaps these for Authgate, Vista, object storage and the AI provider. */
export const DEMO_CODE = "123456";
export const DEMO_PASSWORD = "password123";

export const services: Services = {
  auth: createMockAuth({
    fixedCode: DEMO_CODE,
    users: [
      { email: "priya@gmail.com", password: DEMO_PASSWORD, profile: { name: "Priya S.", phone: "9876543210" } },
      { email: "hrishabh@example.com", password: DEMO_PASSWORD, profile: { name: "Hrishabh" } }
    ]
  }),
  emailVerification: createMockEmailVerification({ fixedCode: DEMO_CODE }),
  storage: createMockStorage(),
  ai: createMockAi()
};

export const userDemo: DemoInfo = { code: DEMO_CODE, signInHint: `Demo account: priya@gmail.com / ${DEMO_PASSWORD}` };
export const adminDemo: DemoInfo = { code: DEMO_CODE, signInHint: `Demo admin: hrishabh@example.com / ${DEMO_PASSWORD}` };
