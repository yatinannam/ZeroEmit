import { describe, expect, test } from "bun:test";
import { formatUpdatedAt, HOUR_MS, intensityAt, istHourStart, liveReading, planByDay, type GridData } from "./grid";

const MINUTE_MS = 60_000;
const hourly = (from: number, hours: number, value = 500) => Array.from({ length: hours }, (_, i) => ({ datetime: new Date(istHourStart(from) + i * HOUR_MS).toISOString(), carbonIntensity: value }));
const withReading = (ageMs: number, now = Date.now()): GridData => ({ available: true, state: "maharashtra", current: { carbonIntensity: 100, datetime: new Date(now - ageMs).toISOString(), isEstimated: true }, forecast: hourly(now, 30), forecastIsTypical: true, source: "test" });

describe("liveReading", () => {
  test("a recent reading stands for right now", () => {
    expect(liveReading(withReading(40 * MINUTE_MS))?.carbonIntensity).toBe(100);
  });

  test("a reading stamped a little ahead of the clock still counts", () => {
    expect(liveReading(withReading(-20 * MINUTE_MS))).toBeDefined();
  });

  test("a reading left over from hours ago doesn't", () => {
    expect(liveReading(withReading(8 * HOUR_MS))).toBeUndefined();
  });
});

describe("planByDay", () => {
  test("merges a recent reading in as Now", () => {
    expect(planByDay(withReading(30 * MINUTE_MS)).today.points[0]).toMatchObject({ isNow: true, carbonIntensity: 100 });
  });

  test("leaves an old reading out, so the forecast isn't shown as Now", () => {
    const first = planByDay(withReading(8 * HOUR_MS)).today.points[0];
    expect(first?.isNow).toBeUndefined();
    expect(first?.carbonIntensity).toBe(500);
  });
});

describe("intensityAt", () => {
  test("a charge around the reading's time gets the live reading", () => {
    expect(intensityAt(withReading(30 * MINUTE_MS), Date.now())?.source).toBe("live");
  });

  test("a charge now, against a reading from hours ago, falls back to the typical hour", () => {
    expect(intensityAt(withReading(8 * HOUR_MS), Date.now())).toMatchObject({ source: "typical", carbonIntensity: 500 });
  });
});

describe("formatUpdatedAt", () => {
  const now = Date.parse("2026-11-03T10:00:00+05:30");

  test("today's update is just the time", () => {
    expect(formatUpdatedAt("2026-11-03T08:00:00+05:30", now)).toBe("8:00 am");
  });

  test("yesterday's says so", () => {
    expect(formatUpdatedAt("2026-11-02T18:00:00+05:30", now)).toBe("yesterday, 6:00 pm");
  });

  test("older ones get the date", () => {
    expect(formatUpdatedAt("2026-11-01T18:00:00+05:30", now)).toBe("1 Nov, 6:00 pm");
  });

  test("never in the future", () => {
    expect(formatUpdatedAt("2026-11-03T11:00:00+05:30", now)).toBe("10:00 am");
  });
});
