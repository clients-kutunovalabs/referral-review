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
  return { kind: "date", label: shortDate(new Date(end), new Date(now)) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "4 Sep" (year added when it is not the current year). Fixed table so output never depends on the runtime's locale data. */
export function shortDate(d: Date, now: Date = new Date()): string {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "6:12 PM" */
export function shortTime(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** Date and time as two separate display strings, for table-like lists. */
export function dateParts(iso: string, now: Date = new Date()): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: shortDate(d, now), time: shortTime(d) };
}

/** "4 Sep, 6:12 PM" */
export function whenLabel(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const { date, time } = dateParts(iso, now);
  return date ? `${date}, ${time}` : "";
}
