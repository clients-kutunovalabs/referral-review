/** "Active till" display for a task: a date, time left (under 24h), or closed. Pure; pass `now` for tests. */
export type ActiveTill =
  | { kind: "none"; label: string }
  | { kind: "date"; label: string }
  | { kind: "left"; label: string }
  | { kind: "closed"; label: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function activeTill(activeUntil: string | null, now: number = Date.now()): ActiveTill {
  if (activeUntil === null) return { kind: "none", label: "No end date" };
  const end = Date.parse(activeUntil);
  if (Number.isNaN(end)) return { kind: "none", label: "No end date" };
  const left = end - now;
  if (left <= 0) return { kind: "closed", label: "Closed" };
  if (left < DAY) {
    const totalMin = Math.ceil(left / 60_000);
    const h = Math.trunc(totalMin / 60);
    const m = totalMin % 60;
    return { kind: "left", label: h > 0 ? `${h}h ${m}m left` : `${m}m left` };
  }
  const d = new Date(end);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  return { kind: "date", label };
}
