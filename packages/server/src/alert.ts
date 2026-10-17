import type { Ctx } from "./ctx";
import { logEvent } from "./log";

const lastSent = new Map<string, number>();
const THROTTLE_MS = 5 * 60_000;
/** For tests only: forget which alerts were sent recently. */
export const resetAlertThrottle = (): void => lastSent.clear();

/**
 * Tells a human something is wrong, by posting to ALERT_WEBHOOK_URL (Slack, Discord, or anything that accepts JSON).
 * Optional: with no URL it does nothing. It never throws, never waits more than 5 seconds, and repeats of the same alert are
 * held back for 5 minutes. Messages carry no personal data: only what failed and where.
 */
export async function sendAlert(ctx: Ctx, text: string, key: string = text): Promise<void> {
  const url = ctx.cfg.alertWebhookUrl;
  if (!url) return;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < THROTTLE_MS) return;
  lastSent.set(key, now);
  try {
    const host = new URL(ctx.cfg.baseUrl).host;
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[${host}] ${text}`, content: `[${host}] ${text}` }), signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) logEvent("warn", "alert.not_delivered", { status: res.status });
  } catch (err) {
    logEvent("warn", "alert.not_delivered", { error: err instanceof Error ? err.name : "error" });
  }
}
