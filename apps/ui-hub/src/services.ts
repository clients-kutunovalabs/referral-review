import { createMockAuth, createMockEmailVerification } from "@rr/auth";
import type { PayoutScenario, Services } from "@rr/core";
import type { DemoInfo } from "@rr/ui";
import { createMockApi, type Mock } from "./mockApi";

/** ui-hub runs entirely on mock adapters. The real site swaps these for HTTP clients that talk to the server. */
export const DEMO_CODE = "123456";
export const DEMO_PASSWORD = "password123";

const auth = createMockAuth({
  fixedCode: DEMO_CODE,
  users: [
    { email: "priya@gmail.com", password: DEMO_PASSWORD, profile: { name: "Priya S.", phone: "9876543210" } },
    { email: "hrishabh@example.com", password: DEMO_PASSWORD, profile: { name: "Hrishabh" } }
  ]
});
const emailVerification = createMockEmailVerification({ fixedCode: DEMO_CODE });

/** One shared demo world: what the user app does, the admin app sees, and the other way round. */
export const world: Mock = createMockApi({ demoCode: DEMO_CODE });

export interface DemoServices { services: Services; markNextPayoutPaid: () => void }

/** Services for a page. Pass a payout scenario or a role to get an isolated demo world; otherwise the shared one is used. */
export function demoServices(opts: { payoutScenario?: PayoutScenario; viewerRoleId?: string } = {}): DemoServices {
  const mock = opts.payoutScenario || (opts.viewerRoleId && opts.viewerRoleId !== "role-owner") ? createMockApi({ demoCode: DEMO_CODE, ...opts }) : world;
  return { services: { auth, emailVerification, api: mock.api }, markNextPayoutPaid: mock.markNextPayoutPaid };
}

export const userDemo: DemoInfo = { code: DEMO_CODE, signInHint: `Demo account: priya@gmail.com / ${DEMO_PASSWORD}` };
export const adminDemo: DemoInfo = { code: DEMO_CODE, signInHint: `Demo admin: hrishabh@example.com / ${DEMO_PASSWORD}` };
