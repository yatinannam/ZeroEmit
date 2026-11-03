import { describe, expect, test } from "bun:test";
import type { Charge } from "../components/use-charges";
import { achievements, baselineFromPattern, chargeOutcome, closestBadge, estimatedCarbonSavedGrams, impactSummary, isGreenCharge, longestStreakDays, MIN_POINTS_KWH, pointsForCharge, totalPoints, weekSummary } from "./rewards";

let nextId = 0;
// A charge `daysAgo` days back at `hour`:00, 20 kWh unless given.
function charge(daysAgo: number, hour: number, intensity: number | null, kwh = 20): Charge {
  const at = new Date();
  at.setDate(at.getDate() - daysAgo);
  at.setHours(hour, 0, 0, 0);
  if (at > new Date()) at.setTime(Date.now() - 60_000);
  return { id: `c${nextId++}`, energyKwh: kwh, chargedAt: `${String(hour).padStart(2, "0")}:00`, city: "Pune, Maharashtra", carbonIntensity: intensity, intensityClass: null, loggedAt: at.toISOString() };
}
const byKey = (charges: Charge[], streak: number) => Object.fromEntries(achievements(charges, streak).map((a) => [a.key, a]));

describe("achievements", () => {
  test("there are eight, in a fixed order, all locked for a new user", () => {
    const list = achievements([], 0);
    expect(list.map((a) => a.key)).toEqual(["first-green", "green-10", "streak-7", "streak-30", "peak-dodger", "co2-10", "co2-50", "kwh-100"]);
    expect(list.every((a) => !a.unlocked && a.current === 0)).toBe(true);
  });

  test("green-charge badges count charges at or under the green threshold", () => {
    const charges = [charge(1, 12, 400), charge(2, 12, 430), charge(3, 20, 650)];
    const list = byKey(charges, 0);
    expect(list["first-green"].unlocked).toBe(true);
    expect(list["green-10"]).toMatchObject({ unlocked: false, current: 2, target: 10 });
  });

  test("streak badges follow the streak passed in", () => {
    const list = byKey([], 9);
    expect(list["streak-7"]).toMatchObject({ unlocked: true, current: 7 }); // capped at the target
    expect(list["streak-30"]).toMatchObject({ unlocked: false, current: 9, target: 30 });
  });

  test("Peak Dodger counts charges outside 6-10 pm", () => {
    const charges = [charge(1, 17, 600), charge(2, 18, 600), charge(3, 21, 600), charge(4, 22, 600), charge(5, 9, 600)];
    expect(byKey(charges, 0)["peak-dodger"]).toMatchObject({ current: 3, target: 5, unlocked: false });
  });

  test("CO2 and energy badges use kg avoided and total kWh", () => {
    // (650 - 400) x 20 = 5 kg each; 3 charges = 15 kg, 60 kWh
    const charges = [charge(1, 12, 400), charge(2, 12, 400), charge(3, 12, 400)];
    const list = byKey(charges, 0);
    expect(list["co2-10"]).toMatchObject({ unlocked: true, current: 10 });
    expect(list["co2-50"]).toMatchObject({ unlocked: false, current: 15, target: 50 });
    expect(list["kwh-100"]).toMatchObject({ unlocked: false, current: 60, target: 100 });
  });
});

describe("chargeOutcome", () => {
  test("announces every badge the new charge unlocks", () => {
    const before = [charge(2, 12, 400, 30), charge(3, 12, 400, 30)]; // 15 kg, 60 kWh, 2 green, 2 off-peak
    const { rewards } = chargeOutcome(before, charge(0, 12, 400, 45)); // +11.25 kg, +45 kWh
    expect(rewards).toContain("Achievement unlocked: 100 kWh Club");
    expect(rewards).not.toContain("Achievement unlocked: First Green Charge"); // already had it
  });

  test("a first green charge is still announced", () => {
    expect(chargeOutcome([], charge(0, 12, 400)).rewards).toContain("Achievement unlocked: First Green Charge");
  });
});

describe("closestBadge", () => {
  const badgeList = (charges: Charge[], streak = 0) => achievements(charges, streak);

  test("nothing when no locked badge is close", () => {
    // 3 green charges at 7 pm: green 3 of 10, peak-dodger 0 of 5, 30% of 50 kg, 60 of 100 kWh, no streak.
    const charges = [charge(1, 19, 400), charge(2, 19, 400), charge(3, 19, 400)];
    expect(closestBadge(badgeList(charges))).toBeNull();
  });

  test("a count badge within 2 steps gets a ready sentence", () => {
    // 8 green charges at 12:00 -> Green Regular is 2 away; First Green and Peak Dodger are done.
    const charges = Array.from({ length: 8 }, (_, i) => charge(i + 1, 12, 400, 2));
    expect(closestBadge(badgeList(charges))).toEqual({ key: "green-10", hint: "2 more green charges to unlock Green Regular." });
  });

  test("singular wording for one step", () => {
    const charges = Array.from({ length: 9 }, (_, i) => charge(i + 1, 12, 400, 2));
    expect(closestBadge(badgeList(charges))?.hint).toBe("1 more green charge to unlock Green Regular.");
  });

  test("CO2 and kWh badges count once at 80% or more", () => {
    // 3 charges of 30 kWh at 600 gCO2/kWh: 90 kWh (90%), 4.5 kg CO2 (45%), none green.
    const charges = [charge(1, 12, 600, 30), charge(2, 12, 600, 30), charge(3, 12, 600, 30)];
    expect(closestBadge(badgeList(charges))).toEqual({ key: "kwh-100", hint: "10 kWh more to unlock 100 kWh Club." });
  });

  test("picks the badge closest to done", () => {
    // 4 charges outside the peak (80% of Peak Dodger, 1 step) beats a streak 2 steps from 7.
    const charges = [charge(1, 12, 600, 5), charge(2, 12, 600, 5), charge(3, 12, 600, 5), charge(4, 12, 600, 5)];
    expect(closestBadge(badgeList(charges, 5))?.key).toBe("peak-dodger");
  });
});

describe("weekSummary", () => {
  // Wednesday 14 Oct 2026, noon IST. The IST week began Monday 12 Oct 00:00 IST.
  const NOW = Date.parse("2026-10-14T06:30:00.000Z");
  const at = (iso: string, intensity: number | null, kwh = 20): Charge => ({ id: iso, energyKwh: kwh, chargedAt: "12:00", city: "Pune, Maharashtra", carbonIntensity: intensity, intensityClass: null, loggedAt: iso });

  test("counts charges since Monday 00:00 IST, with CO2 and green share", () => {
    const charges = [
      at("2026-10-14T05:00:00.000Z", 400), // Wed, green, 5 kg
      at("2026-10-11T18:31:00.000Z", 600), // Mon 00:01 IST, not green, 1 kg
      at("2026-10-11T18:29:00.000Z", 400), // Sun 23:59 IST: last week
    ];
    expect(weekSummary(charges, NOW)).toEqual({ weekStart: "2026-10-12", charges: 2, co2Kg: 6, greenPercent: 50 });
  });

  test("an empty week is all zeros", () => {
    expect(weekSummary([], NOW)).toEqual({ weekStart: "2026-10-12", charges: 0, co2Kg: 0, greenPercent: 0 });
  });
});

describe("points with timing (option A)", () => {
  const timed = (timing: "best" | "cleaner" | "other", intensity: number | null = 600): Charge => ({ ...charge(1, 12, intensity), timing });

  test("10 for logging, plus 10 in a best window or 5 at a cleaner hour", () => {
    expect(pointsForCharge(timed("best"))).toBe(20);
    expect(pointsForCharge(timed("cleaner"))).toBe(15);
    expect(pointsForCharge(timed("other"))).toBe(10);
  });

  test("charges logged before timing existed keep their old points", () => {
    expect(pointsForCharge(charge(1, 12, 400))).toBe(15);
    expect(pointsForCharge(charge(1, 12, 600))).toBe(10);
  });

  test("a green charge is one in a best window once timing is known", () => {
    expect(isGreenCharge(timed("best", 600))).toBe(true);
    expect(isGreenCharge(timed("other", 400))).toBe(false);
    expect(isGreenCharge(charge(1, 12, 400))).toBe(true); // legacy rule
  });
});

describe("longestStreakDays", () => {
  const at = (iso: string): Charge => ({ id: iso, energyKwh: 20, chargedAt: "12:00", city: "Pune, Maharashtra", carbonIntensity: 600, intensityClass: null, loggedAt: iso });

  test("no charges, no streak", () => {
    expect(longestStreakDays([])).toBe(0);
  });

  test("the longest run anywhere in the history, counting each day once", () => {
    const charges = [
      at("2026-09-01T06:00:00.000Z"), at("2026-09-02T06:00:00.000Z"), at("2026-09-02T09:00:00.000Z"), at("2026-09-03T06:00:00.000Z"), // 3 days
      at("2026-09-10T06:00:00.000Z"), // 1 day
      at("2026-10-01T06:00:00.000Z"), at("2026-10-02T06:00:00.000Z"), // 2 days
    ];
    expect(longestStreakDays(charges)).toBe(3);
  });

  test("days are IST days", () => {
    // 23:00 IST on 1 Oct and 00:30 IST on 2 Oct share a UTC day but are two IST days.
    expect(longestStreakDays([at("2026-10-01T17:30:00.000Z"), at("2026-10-01T19:00:00.000Z")])).toBe(2);
    // 00:30 and 23:00 IST on the same day are one.
    expect(longestStreakDays([at("2026-09-30T19:00:00.000Z"), at("2026-10-01T17:30:00.000Z")])).toBe(1);
  });
});

describe("streak badges after a streak breaks", () => {
  // Seven days in a row ending 20 days ago, then nothing until today.
  const earlier = Array.from({ length: 7 }, (_, i) => charge(20 + i, 12, 600));

  test("stay unlocked from the longest streak, even with no current streak", () => {
    expect(byKey(earlier, 0)["streak-7"]).toMatchObject({ unlocked: true, current: 7 });
    expect(byKey(earlier, 0)["streak-30"]).toMatchObject({ unlocked: false, current: 0 }); // progress is the current streak
  });

  test("aren't announced again when a new streak reaches the same length", () => {
    const before = [...Array.from({ length: 6 }, (_, i) => charge(i + 1, 12, 600)), ...earlier];
    expect(chargeOutcome(before, charge(0, 12, 600)).rewards).not.toContain("Achievement unlocked: 7-Day Streak");
  });

  test("an earned streak badge isn't nudged about", () => {
    expect(closestBadge(achievements(earlier, 5))?.key).not.toBe("streak-7");
  });
});

describe("charges too small to earn points", () => {
  test("under 2 kWh earn no points or timing bonus", () => {
    expect(MIN_POINTS_KWH).toBe(2);
    expect(pointsForCharge({ ...charge(1, 12, 400, 0.1), timing: "best" })).toBe(0);
    expect(pointsForCharge({ ...charge(1, 12, 400, 1.9), timing: "best" })).toBe(0);
    expect(pointsForCharge({ ...charge(1, 12, 400, 2), timing: "best" })).toBe(20);
  });

  test("don't unlock or count toward badges", () => {
    const tiny = Array.from({ length: 12 }, (_, i) => ({ ...charge(i + 1, 12, 300, 0.5), timing: "best" as const }));
    const list = byKey(tiny, 0);
    expect(list["first-green"]).toMatchObject({ unlocked: false, current: 0 });
    expect(list["peak-dodger"].current).toBe(0);
    expect(chargeOutcome([], { ...charge(0, 12, 300, 0.1), timing: "best" })).toEqual({ points: 0, green: true, rewards: [] });
  });

  test("still count in energy totals and streaks", () => {
    const tiny = [charge(0, 12, 600, 0.5), charge(1, 12, 600, 0.5), charge(2, 12, 600, 0.5)];
    expect(impactSummary(tiny)).toMatchObject({ kwh: 1.5, count: 3 });
    expect(longestStreakDays(tiny)).toBe(3);
    expect(totalPoints(tiny)).toBe(0);
  });
});

describe("CO2 avoided against the day's average", () => {
  test("a charge's own baseline is used when it has one", () => {
    // Southern grid averaging 677: a 620 charge avoids (677 - 620) x 20 = 1140 g; with the old 650 it would be 600 g.
    expect(estimatedCarbonSavedGrams([{ ...charge(1, 12, 620), baselineIntensity: 677 }])).toBe(1140);
    // At or above the day's average, nothing is avoided.
    expect(estimatedCarbonSavedGrams([{ ...charge(1, 12, 700), baselineIntensity: 677 }])).toBe(0);
  });

  test("older charges without one fall back to 650", () => {
    expect(estimatedCarbonSavedGrams([charge(1, 12, 600)])).toBe(1000);
  });

  test("the baseline is the mean of the hours with data", () => {
    expect(baselineFromPattern([600, null, 700, 650])).toBe(650);
    expect(baselineFromPattern([null, null])).toBeNull();
    expect(baselineFromPattern(null)).toBeNull();
  });
});
