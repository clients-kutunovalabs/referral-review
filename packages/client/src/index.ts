import type { Services } from "@rr/core";
import { createHttpApi } from "./api";
import { createHttpAuth, createHttpEmailVerification } from "./auth";
import { createHttp, type HttpOptions } from "./http";

export { createHttp, type Http, type HttpOptions } from "./http";
export { createHttpApi } from "./api";
export { createHttpAuth, createHttpEmailVerification } from "./auth";
export { MONEY_KEYS, encodeBody, reviveMoney } from "./decode";

/** Everything the browser apps need, talking to this site's own /api. */
export function createHttpServices(opts: HttpOptions = {}): Services {
  const http = createHttp(opts);
  return { auth: createHttpAuth(http), emailVerification: createHttpEmailVerification(http), api: createHttpApi(http) };
}
