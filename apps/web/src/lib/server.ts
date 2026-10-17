import { createApi, createRuntime, prepare, type Runtime } from "@rr/server/runtime-api";

interface Booted { rt: Runtime; api: (req: Request) => Promise<Response> }
const g = globalThis as typeof globalThis & { __rr?: Promise<Booted> };

/** One runtime per server process: database, storage and email are set up on the first request and reused. */
export function boot(): Promise<Booted> {
  g.__rr ??= (async () => {
    const rt = await createRuntime();
    const applied = await prepare(rt);
    if (applied.length) console.info(`[db] applied migrations: ${applied.join(", ")}`);
    return { rt, api: createApi(rt.ctx) };
  })().catch((err) => { g.__rr = undefined; throw err; });
  return g.__rr;
}
