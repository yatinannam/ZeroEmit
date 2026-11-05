import { describe, expect, test } from "bun:test";
import type { Charge } from "../components/use-charges";
import { buildRecap, defaultPeriod, isPeriodKey, periodLabel, previousPeriod, recapPeriods, shortPeriodLabel } from "./recap";

let next = 0;
// A charge at `iso` (UTC) on the western grid, against a 650 baseline.
const charge = (iso: string, extra: Partial<Charge> = {}): Charge => ({ id: String(next++), energyKwh: 10, chargedAt: "23:00", city: "Pune, Maharashtra", carbonIntensity: 600, timing: "other", baselineIntensity: 650, loggedAt: iso, ...extra });

describe("periods", () => {
  const charges = [
    charge("2026-10-03T17:30:00Z"), // 11 pm IST, 3 Oct
    charge("2026-10-31T19:00:00Z"), // 12:30 am IST, 1 Nov
    charge("2026-09-12T08:00:00Z"),
    charge("2025-12-30T08:00:00Z"),
    charge(new Date(0).toISOString()), // an old charge with no real date
  ];

  test("months newest first (by IST), then years with more than one month", () => {
    expect(recapPeriods(charges).map((period) => period.key)).toEqual(["2026-11", "2026-10", "2026-09", "2025-12", "2026", "all"]);
    expect(recapPeriods([])).toEqual([]);
  });

  test("labels", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(periodLabel("2026")).toBe("2026");
    expect(shortPeriodLabel({ key: "2026-10", label: "October 2026", kind: "month" })).toBe("October");
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026")).toBe("2025");
    expect(isPeriodKey("2026-10")).toBe(true);
    expect(isPeriodKey("2026")).toBe(true);
    expect(isPeriodKey("2026-13")).toBe(false);
    expect(isPeriodKey("../x")).toBe(false);
  });

  test("last month in a month's first week, else this month, else the latest", () => {
    const periods = recapPeriods(charges);
    expect(defaultPeriod(periods, Date.parse("2026-11-03T06:00:00Z"))).toBe("2026-10");
    expect(defaultPeriod(periods, Date.parse("2026-11-12T06:00:00Z"))).toBe("2026-11");
    expect(defaultPeriod(periods, Date.parse("2027-02-12T06:00:00Z"))).toBe("2026-11");
    expect(defaultPeriod([], Date.now())).toBeNull();
  });
});

describe("buildRecap", () => {
  const october = [
    charge("2026-10-03T17:30:00Z", { timing: "best", carbonIntensity: 450, energyKwh: 20 }), // Sat
    charge("2026-10-04T17:30:00Z", { timing: "best", carbonIntensity: 480 }), // Sun
    charge("2026-10-10T17:30:00Z", { timing: "cleaner", carbonIntensity: 560, chargedAt: "21:00" }), // Sat
    charge("2026-10-17T17:30:00Z", { timing: "other", carbonIntensity: 700 }), // Sat
  ];
  const september = [charge("2026-09-20T08:00:00Z", { timing: "other" }), charge("2026-09-21T08:00:00Z", { timing: "best" })];

  test("totals, cost, CO₂ and points for the month", () => {
    const recap = buildRecap([...october, ...september], "2026-10", 9)!;
    expect(recap.period).toEqual({ key: "2026-10", label: "October 2026", kind: "month" });
    expect(recap.count).toBe(4);
    expect(recap.kwh).toBe(50);
    expect(recap.cost).toBe(450);
    // (650-450)×20 + (650-480)×10 + (650-560)×10 + 0 = 6600 g
    expect(recap.co2Kg).toBeCloseTo(6.6);
    expect(recap.points).toBe(20 + 20 + 15 + 10);
    expect(recap.cities).toBe(1);
  });

  test("timing split, against the month before", () => {
    const recap = buildRecap([...october, ...september], "2026-10")!;
    expect(recap.timing).toEqual({ best: 2, cleaner: 1, other: 1, untimed: 0 });
    expect(recap.bestShare).toBe(0.5);
    expect(recap.previousBestShare).toBe(0.5);
    expect(buildRecap(october, "2026-10")!.previousBestShare).toBeNull();
  });

  test("cleanest charge, usual time, busiest day and streak", () => {
    const recap = buildRecap(october, "2026-10")!;
    expect(recap.cleanest).toMatchObject({ intensity: 450, chargedAt: "23:00" });
    expect(recap.averageIntensity).toBeCloseTo(547.5);
    expect(recap.usualTime).toBe("23:00");
    expect(recap.busiestWeekday).toBe("Saturday");
    expect(recap.longestStreak).toBe(2);
  });

  test("badges and level reached during the month only", () => {
    const recap = buildRecap([...october, ...september], "2026-10")!;
    // September already had a best-window charge, so First Green Charge isn't new.
    expect(recap.newBadges).not.toContain("First Green Charge");
    expect(buildRecap(october, "2026-10")!.newBadges).toContain("First Green Charge");
    expect(recap.level).toBe("Getting Started");
    expect(recap.levelUp).toBe(false);
  });

  test("a usual time only when one hour clearly leads", () => {
    const at = (time: string, day: number) => charge(`2026-10-${String(day).padStart(2, "0")}T08:00:00Z`, { chargedAt: time });
    expect(buildRecap([at("07:00", 1), at("23:00", 2), at("13:00", 3)], "2026-10")!.usualTime).toBeNull();
    expect(buildRecap([at("07:00", 1), at("23:15", 2)], "2026-10")!.usualTime).toBeNull();
    expect(buildRecap([at("07:00", 1), at("07:00", 2), at("23:00", 3), at("23:30", 4)], "2026-10")!.usualTime).toBeNull();
    expect(buildRecap([at("07:00", 1), at("23:00", 2), at("23:30", 3)], "2026-10")!.usualTime).toBe("23:00");
  });

  test("a year covers its months; an empty period has no recap", () => {
    expect(buildRecap([...october, ...september], "2026")!.count).toBe(6);
    expect(buildRecap(october, "2026-08")).toBeNull();
  });

  test("all time leaves charges with no real date out of the weekday and the cleanest charge", () => {
    const undated = (n: number, extra: Partial<Charge> = {}) => charge(new Date(0).toISOString(), { id: `u${n}`, ...extra });
    const recap = buildRecap([undated(1, { carbonIntensity: 300 }), undated(2), undated(3), undated(4), ...october], "all")!;
    expect(recap.count).toBe(8);
    expect(recap.cleanest).toMatchObject({ intensity: 450 });
    expect(recap.busiestWeekday).toBe("Saturday");
  });

  test("charges from before timing was recorded count as untimed", () => {
    const recap = buildRecap([charge("2026-10-03T17:30:00Z", { timing: undefined })], "2026-10")!;
    expect(recap.timing.untimed).toBe(1);
    expect(recap.bestShare).toBeNull();
    expect(recap.usualTime).toBeNull();
    expect(recap.busiestWeekday).toBeNull();
  });
});
