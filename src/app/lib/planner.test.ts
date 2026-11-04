import { describe, expect, test } from "bun:test";
import { HOUR_MS } from "./grid";
import { averageBetween, bedtimeBefore, chargeDurationMs, chargerKw, CHARGERS, curveEnd, dayWord, formatDuration, isNightStart, nextOccurrence, planCharge } from "./planner";

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

  test("a later start has to be clearly cleaner, or the plan is now", () => {
    // 699 vs 700: 1 g/kWh isn't worth waiting hours for.
    const flat = planCharge({ points: curve([700, 700, 700, 699, 700]), now, kwh: 3.3, kw: 3.3, readyBy: T0 + 5 * HOUR_MS });
    expect(flat.kind === "plan" && flat.startsNow).toBe(true);
    expect(flat.kind === "plan" && flat.savedGrams).toBe(0);
    // 3% of 700 is 21: 680 is too close, 670 is worth it.
    expect(planCharge({ points: curve([700, 700, 680]), now, kwh: 3.3, kw: 3.3, readyBy: T0 + 3 * HOUR_MS }).kind === "plan" && planCharge({ points: curve([700, 700, 680]), now, kwh: 3.3, kw: 3.3, readyBy: T0 + 3 * HOUR_MS }).startsNow).toBe(true);
    const worth = planCharge({ points: curve([700, 700, 670]), now, kwh: 3.3, kw: 3.3, readyBy: T0 + 3 * HOUR_MS });
    expect(worth.kind === "plan" && worth.start).toBe(T0 + 2 * HOUR_MS);
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
  test("night starts, and the bedtime reminder before them", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(isNightStart(at("2026-11-04T20:55:00Z"))).toBe(true); // 2:25 am IST
    expect(isNightStart(at("2026-11-04T16:30:00Z"))).toBe(true); // 10:00 pm IST
    expect(isNightStart(at("2026-11-05T00:30:00Z"))).toBe(false); // 6:00 am IST
    expect(isNightStart(T0)).toBe(false);
    // 2:25 am on the 5th: 9:30 pm on the 4th. 11 pm on the 4th: 9:30 pm that evening.
    expect(bedtimeBefore(at("2026-11-04T20:55:00Z"))).toBe(at("2026-11-04T16:00:00Z"));
    expect(bedtimeBefore(at("2026-11-04T17:30:00Z"))).toBe(at("2026-11-04T16:00:00Z"));
  });
});
