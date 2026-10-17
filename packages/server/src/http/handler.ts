import { ApiError, type UploadKind } from "@rr/core";
import type { OutcomePercent } from "@rr/money";
import type { z } from "zod";
import { createBuiltinAuth, type AuthProvider } from "../auth";
import { claimTask, getClaim, listClaims, retryClaimText } from "../claims";
import type { Ctx } from "../ctx";
import { dashboard } from "../dashboard";
import { UPLOAD_KINDS } from "../constants";
import { mayUpload, readFile, saveUpload } from "../files";
import { addIdentity, getMe, sendIdentityCode } from "../identities";
import { getPayout, listPayouts, markPaid, rejectPayout, releaseUpi, requestPayout } from "../payouts";
import { hit } from "../ratelimit";
import { loadAdmin, type AdminActor } from "../rbac";
import { addMember, createRole, deleteRole, listMembers, listRoles, setMemberRoles, setRolePermissions } from "../roles";
import { csrfToken, createSession, resolveSession, revokeSession, type SessionInfo } from "../sessions";
import { decide, reviewQueue, submitProof } from "../submissions";
import { addScripts, createTask, getAdminTask, listAdminTasks, listBoard, setTaskStatus } from "../tasks";
import { assignTicket, createTicket, getAdminTicket, getUserTicket, listAdminTickets, listUserTickets, replyTicket, resolveTicket, ticketAgents, userSendMessage } from "../tickets";
import { listUsers, setUserStatus } from "../users";
import { walletView } from "../wallet";
import { clearCookie, clientIp, cookieName, errorResponse, json, readCapped, readCookie, readJson, sessionCookie, SECURITY_HEADERS } from "./util";
import { schemas } from "./schemas";

type Level = "public" | "optional" | "user" | "admin";

interface Rc {
  ctx: Ctx; req: Request; params: Record<string, string>; query: URLSearchParams; ip: string;
  session: SessionInfo | null; userId: string;
  admin: AdminActor; // only on "admin" routes
  body<S extends z.ZodTypeAny>(schema: S): Promise<z.infer<S>>;
}
interface Limit { name: string; max: number; windowSeconds: number; per: "ip" | "user" }
interface Route { method: string; regex: RegExp; keys: string[]; level: Level; limit?: Limit; run: (rc: Rc) => unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 60; const HOUR = 3600;
const lim = (name: string, max: number, windowSeconds: number, per: "ip" | "user" = "user"): Limit => ({ name, max, windowSeconds, per });
const AUTH_IP = (name: string, max = 30) => lim(name, max, 10 * MIN, "ip");

/** Ok-with-no-body marker so handlers can return nothing. */
const OK = { ok: true } as const;

/* ---------------- session helpers ---------------- */

async function sessionPayload(ctx: Ctx, userId: string, sessionId: string, expiresAt: Date) {
  const me = await getMe(ctx, userId);
  return {
    session: { user: { id: userId, email: me.email, emailVerified: true, profile: { name: me.name, ...(me.phone ? { phone: me.phone } : {}) } }, expiresAt: expiresAt.toISOString() },
    csrf: csrfToken(ctx, sessionId), isAdmin: me.isAdmin
  };
}

/** Starts a session for a user who has just proved who they are, and answers with it. */
async function startSession(rc: Rc, auth: AuthProvider, userId: string): Promise<Response> {
  void auth;
  const { ctx } = rc;
  const s = await createSession(ctx, userId, { ip: rc.ip, userAgent: rc.req.headers.get("user-agent") ?? undefined });
  const info = (await resolveSession(ctx, s.token))!;
  return json(await sessionPayload(ctx, userId, info.sessionId, s.expiresAt), { headers: { "set-cookie": sessionCookie(ctx, s.token, s.expiresAt) } });
}

/* ---------------- routes: sign-in ---------------- */

export function createApi(ctx: Ctx, deps: { auth?: AuthProvider } = {}): (req: Request) => Promise<Response> {
  const auth = deps.auth ?? createBuiltinAuth(ctx);
  const base = new URL(ctx.cfg.baseUrl).origin;

  const dyn: Route[] = [
    // --- account ---
    mk("POST", "/api/auth/request-code", "public", AUTH_IP("request-code", 20), async (rc) => {
      const b = await rc.body(schemas.requestCode);
      return { sent: await auth.requestCode(b.email, b.purpose, b.profile as Record<string, string> | undefined) };
    }),
    mk("POST", "/api/auth/verify-code", "public", AUTH_IP("verify-code", 40), async (rc) => {
      const b = await rc.body(schemas.verifyCode);
      return auth.verifyCode(b.email, b.code, b.purpose);
    }),
    mk("POST", "/api/auth/set-password", "public", AUTH_IP("set-password", 20), async (rc) => {
      const b = await rc.body(schemas.ticketPassword);
      return startSession(rc, auth, (await auth.completeSignup(b.ticket, b.password)).userId);
    }),
    mk("POST", "/api/auth/reset-password", "public", AUTH_IP("reset-password", 20), async (rc) => {
      const b = await rc.body(schemas.ticketPassword);
      return startSession(rc, auth, (await auth.completeReset(b.ticket, b.password)).userId);
    }),
    mk("POST", "/api/auth/sign-in", "public", AUTH_IP("sign-in", 30), async (rc) => {
      const b = await rc.body(schemas.signIn);
      return startSession(rc, auth, (await auth.signIn(b.email, b.password)).userId);
    }),
    mk("POST", "/api/auth/sign-out", "optional", undefined, async (rc) => {
      const token = readCookie(rc.req, cookieName(rc.ctx));
      if (token) await revokeSession(rc.ctx, token);
      return json(OK, { headers: { "set-cookie": clearCookie(rc.ctx) } });
    }),
    mk("GET", "/api/session", "optional", undefined, async (rc) => {
      if (!rc.session) return { session: null, csrf: null, isAdmin: false };
      return sessionPayload(rc.ctx, rc.session.userId, rc.session.sessionId, rc.session.expiresAt);
    }),

    mk("GET", "/api/health", "public", undefined, async (rc) => { await rc.ctx.db.query("select 1"); return { ok: true }; }),

    // --- worker ---
    mk("GET", "/api/me", "user", undefined, (rc) => getMe(rc.ctx, rc.userId)),
    mk("GET", "/api/tasks", "user", undefined, (rc) => listBoard(rc.ctx)),
    mk("GET", "/api/claims", "user", undefined, (rc) => listClaims(rc.ctx, rc.userId)),
    mk("POST", "/api/claims", "user", lim("claim", 60, 10 * MIN), async (rc) => {
      const b = await rc.body(schemas.claim);
      return claimTask(rc.ctx, rc.userId, b.taskId, b.identityId);
    }),
    mk("POST", "/api/claims/:id/retry-text", "user", lim("retry-text", 20, 10 * MIN), (rc) => retryClaimText(rc.ctx, rc.userId, rc.params["id"] as string)),
    mk("POST", "/api/claims/:id/submit", "user", lim("submit", 60, 10 * MIN), async (rc) => {
      const b = await rc.body(schemas.submit);
      await submitProof(rc.ctx, rc.userId, rc.params["id"] as string, { fileId: b.fileId, note: b.note ?? null });
      return getClaim(rc.ctx, rc.ctx.db, rc.params["id"] as string);
    }),
    mk("GET", "/api/wallet", "user", undefined, (rc) => walletView(rc.ctx, rc.userId)),
    mk("POST", "/api/payouts", "user", lim("payout", 10, HOUR), async (rc) => {
      const b = await rc.body(schemas.payout);
      return requestPayout(rc.ctx, rc.userId, b.amountPaise, b.upi);
    }),
    mk("POST", "/api/identities/send-code", "user", lim("identity-code", 10, HOUR), async (rc) => ({ sent: await sendIdentityCode(rc.ctx, rc.userId, (await rc.body(schemas.sendIdentityCode)).email) })),
    mk("POST", "/api/identities", "user", lim("identity-add", 30, HOUR), async (rc) => {
      const b = await rc.body(schemas.addIdentity);
      return addIdentity(rc.ctx, rc.userId, b.email, b.code);
    }),
    mk("GET", "/api/tickets", "user", undefined, (rc) => listUserTickets(rc.ctx, rc.userId)),
    mk("GET", "/api/tickets/:id", "user", undefined, (rc) => getUserTicket(rc.ctx, rc.userId, rc.params["id"] as string)),
    mk("POST", "/api/tickets", "user", lim("ticket", 20, HOUR), async (rc) => {
      const b = await rc.body(schemas.newTicket);
      return createTicket(rc.ctx, rc.userId, { title: b.title, body: b.body, fileId: b.fileId ?? null });
    }),
    mk("POST", "/api/tickets/:id/messages", "user", lim("ticket-message", 60, HOUR), async (rc) => userSendMessage(rc.ctx, rc.userId, rc.params["id"] as string, (await rc.body(schemas.message)).body)),

    mk("POST", "/api/uploads", "user", lim("upload", 60, HOUR), async (rc) => {
      const kind = rc.query.get("kind") as UploadKind | null;
      if (!kind || !UPLOAD_KINDS.includes(kind)) throw new ApiError("bad_request", "Unknown upload type.");
      const admin = kind === "payment_proof" ? await loadAdmin(rc.ctx.db, rc.userId) : null;
      if (!mayUpload(kind, admin)) throw new ApiError("forbidden", "You do not have permission to do that.", 403);
      const type = rc.req.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("multipart/form-data")) throw new ApiError("bad_request", "Send the image as a form upload.", 415);
      // A little over the 5 MB image limit, for the form framing. Counted on the real bytes, not the declared length.
      let raw: Uint8Array;
      try { raw = await readCapped(rc.req, 5.5 * 1024 * 1024); }
      catch (e) { throw e instanceof ApiError ? new ApiError("upload_invalid", "Image must be under 5 MB.", 413) : e; }
      const file = (await new Request("http://upload.invalid/", { method: "POST", headers: { "content-type": type }, body: raw as BodyInit }).formData().catch(() => null))?.get("file");
      if (!file || typeof file === "string") throw new ApiError("upload_invalid", "Attach an image.");
      if (file.size > 5 * 1024 * 1024) throw new ApiError("upload_invalid", "Image must be under 5 MB.", 413);
      return saveUpload(rc.ctx, rc.userId, kind, new Uint8Array(await file.arrayBuffer()));
    }),
    mk("GET", "/api/files/:id", "user", undefined, async (rc) => {
      const admin = await loadAdmin(rc.ctx.db, rc.userId);
      const f = await readFile(rc.ctx, rc.params["id"] as string, rc.userId, admin);
      return new Response(f.bytes as BodyInit, {
        headers: {
          "content-type": f.contentType, "content-disposition": "inline", "cache-control": "private, max-age=300", ...SECURITY_HEADERS,
          "content-security-policy": "default-src 'none'; sandbox"
        }
      });
    }),

    // --- admin ---
    mk("GET", "/api/admin/me", "admin", undefined, (rc) => ({ userId: rc.admin.userId, name: rc.admin.name, isOwner: rc.admin.isOwner, roleIds: rc.admin.roleIds, permissions: [...rc.admin.permissions] })),
    mk("GET", "/api/admin/dashboard", "admin", undefined, (rc) => dashboard(rc.ctx, rc.admin)),

    mk("GET", "/api/admin/tasks", "admin", undefined, (rc) => listAdminTasks(rc.ctx, rc.admin)),
    mk("POST", "/api/admin/tasks", "admin", lim("admin-task", 60, HOUR), async (rc) => createTask(rc.ctx, rc.admin, (await rc.body(schemas.newTask)) as Parameters<typeof createTask>[2])),
    mk("GET", "/api/admin/tasks/:id", "admin", undefined, (rc) => getAdminTask(rc.ctx, rc.admin, rc.params["id"] as string)),
    mk("POST", "/api/admin/tasks/:id/status", "admin", undefined, async (rc) => { await setTaskStatus(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.taskStatus)).status); return OK; }),
    mk("POST", "/api/admin/tasks/:id/scripts", "admin", undefined, async (rc) => addScripts(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.scripts)).scripts)),

    mk("GET", "/api/admin/review", "admin", undefined, (rc) => reviewQueue(rc.ctx, rc.admin)),
    mk("POST", "/api/admin/review/:id/decide", "admin", undefined, async (rc) => {
      const b = await rc.body(schemas.decide);
      await decide(rc.ctx, rc.admin, rc.params["id"] as string, b.outcome as OutcomePercent, b.note);
      return OK;
    }),

    mk("GET", "/api/admin/payouts", "admin", undefined, (rc) => listPayouts(rc.ctx, rc.admin)),
    mk("GET", "/api/admin/payouts/:id", "admin", lim("view-upi", 120, HOUR), (rc) => getPayout(rc.ctx, rc.admin, rc.params["id"] as string)),
    mk("POST", "/api/admin/payouts/:id/reject", "admin", undefined, async (rc) => { await rejectPayout(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.rejectPayout)).reason); return OK; }),
    mk("POST", "/api/admin/upi/release", "admin", lim("release-upi", 30, HOUR), async (rc) => { await releaseUpi(rc.ctx, rc.admin, (await rc.body(schemas.releaseUpi)).upi); return OK; }),
    mk("POST", "/api/admin/payouts/:id/pay", "admin", undefined, async (rc) => { await markPaid(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.pay)).proofFileId); return OK; }),

    mk("GET", "/api/admin/users", "admin", undefined, (rc) => listUsers(rc.ctx, rc.admin)),
    mk("POST", "/api/admin/users/:id/status", "admin", undefined, async (rc) => { await setUserStatus(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.userStatus)).status); return OK; }),

    mk("GET", "/api/admin/members", "admin", undefined, (rc) => listMembers(rc.ctx, rc.admin)),
    mk("POST", "/api/admin/members", "admin", undefined, async (rc) => addMember(rc.ctx, rc.admin, (await rc.body(schemas.addMember)).email)),
    mk("POST", "/api/admin/members/:id/roles", "admin", undefined, async (rc) => { await setMemberRoles(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.memberRoles)).roleIds); return OK; }),
    mk("GET", "/api/admin/roles", "admin", undefined, (rc) => listRoles(rc.ctx)),
    mk("POST", "/api/admin/roles", "admin", undefined, async (rc) => createRole(rc.ctx, rc.admin, (await rc.body(schemas.newRole)).name)),
    mk("POST", "/api/admin/roles/:id/permissions", "admin", undefined, async (rc) => { await setRolePermissions(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.rolePermissions)).permissions as never); return OK; }),
    mk("DELETE", "/api/admin/roles/:id", "admin", undefined, async (rc) => { await deleteRole(rc.ctx, rc.admin, rc.params["id"] as string); return OK; }),

    mk("GET", "/api/admin/tickets", "admin", undefined, (rc) => listAdminTickets(rc.ctx, rc.admin)),
    mk("GET", "/api/admin/tickets/:id", "admin", undefined, (rc) => getAdminTicket(rc.ctx, rc.admin, rc.params["id"] as string)),
    mk("POST", "/api/admin/tickets/:id/assign", "admin", undefined, async (rc) => assignTicket(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.assign)).assigneeId)),
    mk("POST", "/api/admin/tickets/:id/reply", "admin", undefined, async (rc) => replyTicket(rc.ctx, rc.admin, rc.params["id"] as string, (await rc.body(schemas.reply)).body)),
    mk("POST", "/api/admin/tickets/:id/resolve", "admin", undefined, (rc) => resolveTicket(rc.ctx, rc.admin, rc.params["id"] as string)),
    mk("GET", "/api/admin/ticket-agents", "admin", undefined, (rc) => ticketAgents(rc.ctx, rc.admin))
  ];

  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  return async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const matches = dyn.filter((r) => r.regex.test(url.pathname));
      if (!matches.length) throw new ApiError("not_found", "That endpoint does not exist.", 404);
      const found = matches.find((r) => r.method === req.method);
      if (!found) return json({ error: { code: "bad_request", message: "Method not allowed." } }, { status: 405, headers: { allow: matches.map((m) => m.method).join(", ") } });
      const mutating = MUTATING.has(req.method);

      // Cross-site requests are refused outright: the site is only ever called by its own pages.
      if (mutating) {
        const origin = req.headers.get("origin");
        const fetchSite = req.headers.get("sec-fetch-site");
        const ok = origin ? origin === base : fetchSite === "same-origin";
        if (!ok) throw new ApiError("csrf", "This request did not come from the site.", 403);
      }

      const token = readCookie(req, cookieName(ctx));
      const session = token ? await resolveSession(ctx, token) : null;
      if ((found.level === "user" || found.level === "admin") && !session) throw new ApiError("unauthenticated", "Please log in.", 401);
      if (mutating && session && found.level !== "public" && found.level !== "optional") {
        const sent = req.headers.get("x-csrf-token") ?? "";
        if (sent !== csrfToken(ctx, session.sessionId)) throw new ApiError("csrf", "Your session needs a refresh. Reload the page.", 403);
      }

      const ip = clientIp(req, ctx.cfg.trustProxyHops);
      if (found.limit) {
        const who = found.limit.per === "ip" || !session ? `ip:${ip}` : `user:${session.userId}`;
        const h = await hit(ctx.db, `rl:${found.limit.name}:${who}`, found.limit.max, found.limit.windowSeconds, ctx.now());
        if (!h.allowed) throw new ApiError("rate_limited", "Too many attempts. Please wait a bit and try again.", 429, h.retryAfterSeconds);
      }

      const m = found.regex.exec(url.pathname) as RegExpExecArray;
      const params: Record<string, string> = {};
      found.keys.forEach((k, i) => {
        let v: string;
        try { v = decodeURIComponent(m[i + 1] as string); } catch { throw new ApiError("not_found", "That does not exist.", 404); }
        // Every id in a path is a UUID. Anything else cannot exist, so it is a plain 404 and never reaches the database.
        if (!UUID.test(v)) throw new ApiError("not_found", "That does not exist.", 404);
        params[k] = v;
      });

      let admin: AdminActor | undefined;
      if (found.level === "admin") {
        const a = await loadAdmin(ctx.db, (session as SessionInfo).userId);
        if (!a) throw new ApiError("forbidden", "Admin access required.", 403);
        admin = a;
      }
      const rc: Rc = {
        ctx, req, params, query: url.searchParams, ip, session, userId: session?.userId ?? "", admin: admin as AdminActor,
        async body(schema) {
          const parsed = schema.safeParse(await readJson(req));
          if (!parsed.success) throw new ApiError("bad_request", parsed.error.issues[0]?.message ?? "That request is not valid.", 400);
          return parsed.data;
        }
      };
      const out = await found.run(rc);
      const res = out instanceof Response ? out : json(out);
      // A visit restarted the idle count on the server, so the browser's copy of the cookie must be pushed out too.
      if (session?.refreshed && token && !res.headers.has("set-cookie")) res.headers.append("set-cookie", sessionCookie(ctx, token, session.expiresAt));
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  };

  function mk(method: string, path: string, level: Level, limit: Limit | undefined, run: Route["run"]): Route {
    const keys: string[] = [];
    const regex = new RegExp("^" + path.replace(/:([a-z]+)/g, (_m, k: string) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    return { method, regex, keys, level, ...(limit ? { limit } : {}), run };
  }
}
