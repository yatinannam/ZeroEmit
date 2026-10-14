import { describe, expect, test } from "bun:test";
import type { Charge } from "../components/use-charges";
import { istMonthKey, scoreMonth, toLeaderboardCharges, validateDisplayName, type LeaderboardCharge } from "./leaderboard";

const entry = (date: string, kwh = 20, intensity: number | null = 600, green = false): LeaderboardCharge => ({ date, kwh, intensity, green });
const MONTH = "2026-10";
const TODAY = "2026-10-14";

describe("scoreMonth", () => {
  test("10 points a charge, +5 when green", () => {
    expect(scoreMonth([entry("2026-10-01"), entry("2026-10-02", 20, 400, true)], MONTH, TODAY).points).toBe(25);
  });

  test("green only counts when an intensity was recorded", () => {
    expect(scoreMonth([entry("2026-10-01", 20, null, true)], MONTH, TODAY).points).toBe(10);
  });

  test("CO2 avoided is (650 - intensity) x kWh, never negative, skipped without intensity, in kg to 0.1", () => {
    // (650 - 400) x 20 = 5000 g; 700 is above the baseline -> 0; null -> 0
    const result = scoreMonth([entry("2026-10-01", 20, 400), entry("2026-10-02", 20, 700), entry("2026-10-03", 20, null)], MONTH, TODAY);
    expect(result.co2Kg).toBe(5);
  });

  test("only the best two charges of a day count", () => {
    const day = [entry("2026-10-05"), entry("2026-10-05", 20, 400, true), entry("2026-10-05"), entry("2026-10-05", 20, 300, true)];
    expect(scoreMonth(day, MONTH, TODAY).points).toBe(30);
  });

  test("other months and future days are ignored", () => {
    const result = scoreMonth([entry("2026-09-30"), entry("2026-10-15"), entry("2026-11-01"), entry("2026-10-14")], MONTH, TODAY);
    expect(result.points).toBe(10);
  });

  test("kWh is capped at 150 and intensity clamped to 0..2000", () => {
    // kWh 500 -> 150, intensity -100 -> 0: (650 - 0) x 150 = 97500 g
    expect(scoreMonth([entry("2026-10-01", 500, -100)], MONTH, TODAY).co2Kg).toBe(97.5);
    // intensity 5000 -> 2000, above the baseline -> no CO2, still a charge
    expect(scoreMonth([entry("2026-10-01", 20, 5000)], MONTH, TODAY)).toEqual({ points: 10, co2Kg: 0 });
  });

  test("dates that aren't real days are ignored", () => {
    const result = scoreMonth([entry("2026-10-00"), entry("2026-10-32"), entry("2026-10-01")], MONTH, "2026-10-31");
    expect(result.points).toBe(10);
  });

  test("a full month at the cap is 31 x 2 x 15 = 930 points", () => {
    const month = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`)
      .flatMap((date) => [entry(date, 20, 300, true), entry(date, 20, 300, true), entry(date, 20, 300, true)]);
    expect(scoreMonth(month, MONTH, "2026-10-31").points).toBe(930);
  });
});

describe("istMonthKey", () => {
  test("uses IST, not UTC or the device timezone", () => {
    expect(istMonthKey("2026-10-31T18:00:00.000Z")).toBe("2026-10"); // 23:30 IST, 31 Oct
    expect(istMonthKey("2026-10-31T19:00:00.000Z")).toBe("2026-11"); // 00:30 IST, 1 Nov
  });
});

describe("toLeaderboardCharges", () => {
  const charge = (loggedAt: string, extra: Partial<Charge> = {}): Charge => ({ id: loggedAt, energyKwh: 18, chargedAt: "10:00", city: "Pune, Maharashtra", carbonIntensity: 420, intensityClass: null, loggedAt, ...extra });

  test("keeps only this IST month's charges, dated in IST", () => {
    const out = toLeaderboardCharges([charge("2026-10-31T19:00:00.000Z"), charge("2026-10-31T18:00:00.000Z"), charge("2026-09-30T10:00:00.000Z")], "2026-10");
    expect(out).toEqual([{ date: "2026-10-31", kwh: 18, intensity: 420, green: true, hour: 23, timing: null }]); // 23:30 IST
  });

  test("green follows the app's rule: the provider's class wins over the fallback threshold", () => {
    const out = toLeaderboardCharges([charge("2026-10-10T05:00:00.000Z", { intensityClass: "yellow" })], "2026-10");
    expect(out[0].green).toBe(false);
  });

  test("sends at most 100 charges", () => {
    const many = Array.from({ length: 120 }, (_, i) => charge(new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 3_600_000).toISOString()));
    expect(toLeaderboardCharges(many, "2026-10")).toHaveLength(100);
  });
});

describe("validateDisplayName", () => {
  test("trims and collapses spaces", () => {
    expect(validateDisplayName("  Asha   Rao ")).toBe("Asha Rao");
  });

  test("accepts letters in any script", () => {
    expect(validateDisplayName("राहुल")).toBe("राहुल");
  });

  test("accepts the zero-width joiners Malayalam and Bengali keyboards insert", () => {
    expect(validateDisplayName("ശ്രീ‍കാന്ത്")).toBe("ശ്രീ‍കാന്ത്");
    expect(validateDisplayName("রাজ‌শ্রী")).toBe("রাজ‌শ্রী");
  });

  test("ordinary names that share a blocked word's spelling pass", () => {
    expect(validateDisplayName("Dick Smith")).toBe("Dick Smith");
  });

  test("rejects too short, too long, symbols and non-strings", () => {
    expect(validateDisplayName("A")).toBeNull();
    expect(validateDisplayName("x".repeat(21))).toBeNull();
    expect(validateDisplayName("<script>")).toBeNull();
    expect(validateDisplayName("Rahul_1")).toBeNull();
    expect(validateDisplayName(42)).toBeNull();
  });

  test("blocks offensive words without blocking ordinary names", () => {
    expect(validateDisplayName("fuck you")).toBeNull();
    expect(validateDisplayName("xFuCkx")).toBeNull();
    expect(validateDisplayName("Dickens")).toBe("Dickens");
    expect(validateDisplayName("Lundgren")).toBe("Lundgren");
  });
});

describe("validateDisplayName with joiners", () => {
  test("a joiner can't hide a blocked word or make a name invisible", () => {
    expect(validateDisplayName("sh\u200Dit")).toBeNull();
    expect(validateDisplayName("\u200D\u200D")).toBeNull();
    expect(validateDisplayName("Asha\u200D")).toBeNull();
    expect(validateDisplayName("\u200CAsha")).toBeNull();
  });
});

describe("scoreMonth with timing (option A)", () => {
  // Typical day: 600 everywhere except a clean midday window and a slightly cleaner 8 am.
  const pattern = Array.from({ length: 24 }, () => 600 as number | null);
  pattern[12] = 300; pattern[13] = 300; pattern[2] = 350; pattern[3] = 350; pattern[20] = 380; pattern[21] = 380; pattern[8] = 500;
  const timed = (date: string, hour: number | null, timing: "best" | "cleaner" | "other" | null): LeaderboardCharge => ({ date, kwh: 20, intensity: 600, green: false, hour, timing });

  test("the server's own pattern decides the bonus, whatever the device claims", () => {
    const entries = [timed("2026-10-01", 12, "other"), timed("2026-10-02", 8, "best"), timed("2026-10-03", 18, "best")];
    expect(scoreMonth(entries, MONTH, TODAY, pattern).points).toBe(20 + 15 + 10);
  });

  test("without server data, the device's claim is used", () => {
    expect(scoreMonth([timed("2026-10-01", 12, "best"), timed("2026-10-02", 8, "cleaner")], MONTH, TODAY, null).points).toBe(20 + 15);
  });

  test("charges from before timing keep the old green rule", () => {
    expect(scoreMonth([entry("2026-10-01", 20, 400, true)], MONTH, TODAY, pattern).points).toBe(15);
  });

  test("a full month at the cap is 31 x 2 x 20 = 1240 points", () => {
    const month = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`).flatMap((date) => [timed(date, 12, "other"), timed(date, 13, "other"), timed(date, 2, "other")]);
    expect(scoreMonth(month, MONTH, "2026-10-31", pattern).points).toBe(1240);
  });
});

describe("toLeaderboardCharges with timing", () => {
  test("sends the IST hour and the device's timing", () => {
    const charge: Charge = { id: "x", energyKwh: 18, chargedAt: "12:30", city: "Chennai, Tamil Nadu", carbonIntensity: 520, intensityClass: "yellow", loggedAt: "2026-10-10T07:00:00.000Z", timing: "best" };
    expect(toLeaderboardCharges([charge], "2026-10")).toEqual([{ date: "2026-10-10", kwh: 18, intensity: 520, green: true, hour: 12, timing: "best" }]);
  });
});
