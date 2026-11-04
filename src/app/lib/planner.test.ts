import { describe, expect, test } from "bun:test";
import { HOUR_MS } from "./grid";
import { averageBetween, chargeDurationMs, chargerKw, CHARGERS, curveEnd, dayWord, formatDuration, nextOccurrence, planCharge } from "./planner";

// 10:00 IST on 4 Nov 2026 (04:30 UTC), and an hourly curve from then on.
const T0 = Date.parse("2026-11-04T04:30:00Z");
const curve = (values: number[], from = T0) => values.map((carbonIntensity, index) => ({ datetime: new Date(from + index * HOUR_MS).toISOString(), carbonIntensity }));
const MIN = 60_000;

describe("chargeDurationMs", () => {
  test("rounds up to 5 minutes", () => {
    expect(chargeDurationMs(10, 3.3)).toBe(185 * MIN); // 181.8 min
    expect(chargeDurationMs(7.2, 7.2)).toBe(60 * MIN);
    expect(chargeDurationMs(0.1, 30)).toBe(5 * MIN);
  });
});

describe("averageBetween", () => {
  const points = curve([600, 300, 500]);
  test("weights each hour by the time spent in it", () => {
    expect(averageBetween(points, T0, T0 + HOUR_MS)).toBe(600);
    expect(averageBetween(points, T0 + 30 * MIN, T0 + 90 * MIN)).toBe(450);
    expect(averageBetween(points, T0 + HOUR_MS, T0 + 3 * HOUR_MS)).toBe(400);
  });
  test("null past the end of the curve or across a gap", () => {
    expect(averageBetween(points, T0 + 2 * HOUR_MS, T0 + 4 * HOUR_MS)).toBeNull();
    const gappy = [points[0], points[2]];
    expect(averageBetween(gappy, T0, T0 + 3 * HOUR_MS)).toBeNull();
    expect(averageBetween(points, T0, T0)).toBeNull();
  });
  test("curveEnd is the end of the last hour", () => {
    expect(curveEnd(points)).toBe(T0 + 3 * HOUR_MS);
    expect(curveEnd([])).toBe(0);
  });
});

describe("nextOccurrence", () => {
  test("later today, or tomorrow once it has passed (IST)", () => {
    expect(nextOccurrence("18:00", T0)).toBe(Date.parse("2026-11-04T12:30:00Z"));
    expect(nextOccurrence("07:00", T0)).toBe(Date.parse("2026-11-05T01:30:00Z"));
    expect(nextOccurrence("10:00", T0)).toBe(Date.parse("2026-11-05T04:30:00Z"));
  });
  test("refuses times that aren't on a clock", () => {
    expect(nextOccurrence("24:00", T0)).toBeNull();
    expect(nextOccurrence("7am", T0)).toBeNull();
    expect(nextOccurrence("", T0)).toBeNull();
  });
});

describe("planCharge", () => {
  // 10 am 600, 11 am 600, noon 300, 1 pm 300, 2 pm 600, ...
  const points = curve([600, 600, 300, 300, 600, 600, 600, 600]);
  const now = T0 + 20 * MIN; // 10:20 am

  test("starts on the clean stretch and reports what waiting saves", () => {
    const plan = planCharge({ points, now, kwh: 6.6, kw: 3.3, readyBy: T0 + 8 * HOUR_MS });
    expect(plan.kind).toBe("plan");
    if (plan.kind !== "plan") return;
    expect(plan.start).toBe(T0 + 2 * HOUR_MS);
    expect(plan.end).toBe(T0 + 4 * HOUR_MS);
    expect(plan.average).toBe(300);
    expect(plan.startsNow).toBe(false);
    // Now: 10:20–12:20 is 100 min at 600 and 20 at 300 = 550.
    expect(plan.nowAverage).toBe(550);
    expect(plan.savedGrams).toBeCloseTo(250 * 6.6);
    expect(plan.cleanerPercent).toBe(45);
  });

  test("a charge longer than the dip lines up with it rather than starting at it", () => {
    // 3 hours: 11 am–2 pm (600, 300, 300) and noon–3 pm (300, 300, 600)
    // both average 400, and the earlier one wins the tie.
    const plan = planCharge({ points, now, kwh: 9.9, kw: 3.3, readyBy: T0 + 8 * HOUR_MS });
    expect(plan.kind === "plan" && plan.start).toBe(T0 + HOUR_MS);
  });

  test("a deadline before the dip is the limit", () => {
    const plan = planCharge({ points, now, kwh: 3.3, kw: 3.3, readyBy: T0 + 2.5 * HOUR_MS });
    expect(plan.kind).toBe("plan");
    if (plan.kind !== "plan") return;
    // Latest start is 11:30 (ends 12:30): half at 600, half at 300.
    expect(plan.start).toBe(T0 + 1.5 * HOUR_MS);
    expect(plan.average).toBe(450);
  });

  test("starts now when now is already cleanest", () => {
    const plan = planCharge({ points: curve([200, 600, 600]), now, kwh: 1, kw: 7.2, readyBy: T0 + 3 * HOUR_MS });
    expect(plan.kind === "plan" && plan.startsNow).toBe(true);
    expect(plan.kind === "plan" && plan.savedGrams).toBe(0);
  });

  test("not enough time: says how much plugging in now adds", () => {
    const plan = planCharge({ points, now, kwh: 30, kw: 3.3, readyBy: now + 2 * HOUR_MS });
    expect(plan).toEqual({ kind: "short", durationMs: chargeDurationMs(30, 3.3), availableMs: 2 * HOUR_MS, kwhByDeadline: 6.6 });
  });

  test("a charge that runs past the end of the curve can't be judged", () => {
    expect(planCharge({ points, now, kwh: 3.3, kw: 3.3, readyBy: T0 + 30 * HOUR_MS }).kind).toBe("plan");
    expect(planCharge({ points: curve([600, 600]), now, kwh: 6.6, kw: 3.3, readyBy: T0 + 30 * HOUR_MS }).kind).toBe("beyond");
  });

  test("no curve, no plan", () => {
    expect(planCharge({ points: [], now, kwh: 5, kw: 3.3, readyBy: now + 10 * HOUR_MS }).kind).toBe("no-data");
    expect(planCharge({ points, now, kwh: 0, kw: 3.3, readyBy: now + 10 * HOUR_MS }).kind).toBe("no-data");
  });
});

describe("labels", () => {
  test("formatDuration", () => {
    expect(formatDuration(45 * MIN)).toBe("45 min");
    expect(formatDuration(120 * MIN)).toBe("2 h");
    expect(formatDuration(315 * MIN)).toBe("5 h 15 min");
  });
  test("dayWord", () => {
    expect(dayWord(T0 + HOUR_MS, T0)).toBe("today");
    expect(dayWord(T0 + 9 * HOUR_MS, T0)).toBe("tonight");
    expect(dayWord(T0 + 20 * HOUR_MS, T0)).toBe("tomorrow");
    expect(dayWord(T0 + 50 * HOUR_MS, T0)).toBe("");
  });
  test("every charger has a speed", () => {
    for (const charger of CHARGERS) expect(chargerKw(charger.key)).toBeGreaterThan(0);
  });
});
