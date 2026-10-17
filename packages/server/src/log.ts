/** One JSON line per event, so a log service can search and alert on it. Never put personal data or secrets in `data`. */
export function logEvent(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line); else console.log(line);
}

export const errorName = (err: unknown): string => (err instanceof Error ? err.name : typeof err);
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
