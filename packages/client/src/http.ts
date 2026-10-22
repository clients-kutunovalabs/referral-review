import { API_ERROR_CODES, ApiError, type ApiErrorCode } from "@rr/core";
import { encodeBody, reviveMoney } from "./decode";

export interface HttpOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface Http {
  request<T>(method: string, path: string, opts?: { body?: unknown; form?: FormData }): Promise<T>;
  upload(kind: "proof" | "payment_proof" | "ticket_attachment", file: File): Promise<string>;
  /** Remembers the CSRF token a sign-in or session response carried. */
  setCsrf(token: string | null): void;
}

const ERROR_CODES = new Set<string>(API_ERROR_CODES);

/** Talks to /api: JSON in and out, cookies for the session, a CSRF header on every write, money revived to bigint. */
export function createHttp(opts: HttpOptions = {}): Http {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = opts.baseUrl ?? "";
  let csrf: string | null = null;

  async function send(method: string, path: string, body: BodyInit | undefined, json: boolean): Promise<Response> {
    const headers: Record<string, string> = {};
    if (json) headers["content-type"] = "application/json";
    if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    return doFetch(base + path, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body } : {}) });
  }

  async function refreshCsrf(): Promise<void> {
    const res = await doFetch(base + "/api/session", { credentials: "same-origin" });
    const data = (await res.json().catch(() => null)) as { csrf?: string | null } | null;
    csrf = data?.csrf ?? null;
  }

  async function request<T>(method: string, path: string, o: { body?: unknown; form?: FormData } = {}): Promise<T> {
    const body: BodyInit | undefined = o.form ?? (o.body !== undefined ? encodeBody(o.body) : method === "GET" ? undefined : "{}");
    const isJson = !o.form && body !== undefined;
    if (method !== "GET" && !csrf && path !== "/api/session" && !path.startsWith("/api/auth/")) await refreshCsrf();
    let res = await send(method, path, body, isJson);
    let data = await parse(res);
    if (!res.ok && errorCode(data) === "csrf" && !path.startsWith("/api/auth/")) {
      await refreshCsrf();
      res = await send(method, path, body, isJson);
      data = await parse(res);
    }
    if (!res.ok) throw toError(res.status, data, res.headers.get("retry-after"));
    return reviveMoney<T>(data);
  }

  return {
    request,
    setCsrf: (t) => { csrf = t; },
    async upload(kind, file) {
      const form = new FormData();
      form.set("file", file);
      return (await request<{ fileId: string }>("POST", `/api/uploads?kind=${kind}`, { form })).fileId;
    }
  };
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
const errorCode = (data: unknown): string | undefined => (data as { error?: { code?: string } } | null)?.error?.code;

function toError(status: number, data: unknown, retryAfter: string | null): ApiError {
  const e = (data as { error?: { code?: string; message?: string; retryAfterSeconds?: number } } | null)?.error;
  const code = (e?.code && ERROR_CODES.has(e.code) ? e.code : status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : "internal") as ApiErrorCode;
  const message = e?.message ?? (status >= 500 ? "Something went wrong on our side. Please try again." : "That did not work. Please try again.");
  const wait = e?.retryAfterSeconds ?? (retryAfter ? Number(retryAfter) : undefined);
  return new ApiError(code, message, status, wait && Number.isFinite(wait) ? wait : undefined);
}
