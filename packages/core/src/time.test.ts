import { describe, expect, it } from "vitest";
import { activeTill } from "./time";

const now = Date.parse("2026-10-01T10:00:00Z");
const at = (ms: number) => new Date(now + ms).toISOString();

describe("activeTill", () => {
  it("no end date", () => expect(activeTill(null, now)).toEqual({ kind: "none", label: "No end date" }));
  it("closed when the end has passed or is now", () => {
    expect(activeTill(at(-1), now).kind).toBe("closed");
    expect(activeTill(at(0), now).kind).toBe("closed");
  });
  it("time left under 24 hours", () => {
    expect(activeTill(at(5 * 3_600_000 + 20 * 60_000), now)).toEqual({ kind: "left", label: "5h 20m left" });
    expect(activeTill(at(45 * 60_000), now)).toEqual({ kind: "left", label: "45m left" });
    expect(activeTill(at(23 * 3_600_000 + 59 * 60_000), now).kind).toBe("left");
  });
  it("a date from 24 hours on", () => {
    const r = activeTill(at(24 * 3_600_000), now);
    expect(r.kind).toBe("date");
    expect(r.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });
  it("includes the year when it is not this year", () => {
    expect(activeTill("2027-02-03T00:00:00Z", now).label).toMatch(/2027/);
  });
  it("invalid input is treated as no end date", () => expect(activeTill("nope", now).kind).toBe("none"));
});

import { dateParts, shortDate, shortTime } from "./time";

describe("dateParts", () => {
  const n = new Date("2026-10-01T10:00:00");
  it("splits date and time", () => expect(dateParts("2026-09-04T18:12:00", n)).toEqual({ date: "4 Sep", time: "6:12 PM" }));
  it("morning, noon and midnight", () => {
    expect(shortTime(new Date("2026-09-03T11:04:00"))).toBe("11:04 AM");
    expect(shortTime(new Date("2026-09-03T12:00:00"))).toBe("12:00 PM");
    expect(shortTime(new Date("2026-09-03T00:05:00"))).toBe("12:05 AM");
  });
  it("adds the year for other years", () => expect(shortDate(new Date("2025-12-31T09:05:00"), n)).toBe("31 Dec 2025"));
  it("handles bad input", () => expect(dateParts("nope", n)).toEqual({ date: "", time: "" }));
});
