import { DEV_ACCOUNTS, DEV_PASSWORD } from "@rr/server/runtime-api";
import { boot } from "@/lib/server";
import { devLoginAllowed, notFound } from "@/lib/devguard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Development only: a launch pad with one-click sign-in for both apps. */
export async function GET(req: Request): Promise<Response> {
  const { rt } = await boot();
  if (!devLoginAllowed(rt, req)) return notFound();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Developer launch pad</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;color:#1c1c1c}a.btn{display:block;padding:14px 16px;margin:10px 0;border:1px solid #bbb;border-radius:10px;text-decoration:none;color:inherit;font-weight:600}a.btn small{display:block;font-weight:400;color:#555}code{background:#f1f1f1;padding:1px 5px;border-radius:4px}.warn{background:#fff4d6;border-radius:10px;padding:10px 14px}</style></head><body>
<h1>Developer launch pad</h1>
<p class="warn">Development only. This page and one-click sign-in do not exist in production: the site refuses to start with <code>DEV_LOGIN</code> on there.</p>
<a class="btn" href="/dev/login?as=worker">Open the worker app, signed in<small>${DEV_ACCOUNTS.worker.name} · has money to withdraw · http://localhost</small></a>
<a class="btn" href="/dev/login?as=admin">Open the admin app, signed in<small>${DEV_ACCOUNTS.admin.name} · every permission · a review and a ticket are waiting</small></a>
<a class="btn" href="/">Worker app, normal login screen</a>
<a class="btn" href="/admin">Admin app, normal login screen</a>
<h2>To try the real login screens</h2>
<p>Password for every demo account: <code>${DEV_PASSWORD}</code></p>
<ul><li>${DEV_ACCOUNTS.worker.email}</li><li>${DEV_ACCOUNTS.worker2.email} (has work waiting for review)</li><li>${DEV_ACCOUNTS.admin.email} (admin)</li></ul>
<p>Sign-up and reset codes are printed in the terminal where <code>npm run dev</code> runs.</p>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
