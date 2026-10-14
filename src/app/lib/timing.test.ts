import { describe, expect, test } from "bun:test";
import { chargeTiming, hourlyPattern, TIMING_BONUS } from "./timing";

// A typical day at 600 gCO2/kWh with three clean dips: 12-2 pm (300),
// 2-4 am (350) and 8-10 pm (380); 8 am is a bit below average (500).
const day = Array.from({ length: 24 }, () => 600 as number | null);
day[12] = 300; day[13] = 300;
day[2] = 350; day[3] = 350;
day[20] = 380; day[21] = 380;
day[8] = 500;

describe("chargeTiming", () => {
  test("hours inside the day's 3 cleanest 2-hour windows are best", () => {
    for (const hour of [12, 13, 2, 3, 20, 21]) expect(chargeTiming(day, hour)).toBe("best");
  });

  test("an hour below the day's average, outside those windows, is cleaner", () => {
    expect(chargeTiming(day, 8)).toBe("cleaner");
  });

  test("anything else earns no timing bonus", () => {
    expect(chargeTiming(day, 18)).toBe("other");
    expect(chargeTiming(day, 11)).toBe("other");
  });

  test("hours with no data count at the day's average", () => {
    const gappy = [...day];
    gappy[5] = null;
    expect(chargeTiming(gappy, 5)).toBe("other");
    expect(chargeTiming(gappy, 12)).toBe("best");
  });

  test("bonuses: 10 for a best window, 5 for a cleaner hour", () => {
    expect(TIMING_BONUS).toEqual({ best: 10, cleaner: 5, other: 0 });
  });
});

describe("hourlyPattern", () => {
  test("reads a forecast into values by IST hour, first value wins", () => {
    const start = Date.parse("2026-10-14T00:00:00+05:30");
    const forecast = Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(start + i * 3_600_000).toISOString(), carbonIntensity: i < 24 ? 400 + i : 999 }));
    const pattern = hourlyPattern(forecast);
    expect(pattern).toHaveLength(24);
    expect(pattern[0]).toBe(400);
    expect(pattern[23]).toBe(423);
  });

  test("hours the forecast doesn't cover are null", () => {
    const forecast = [{ datetime: "2026-10-14T06:30:00.000Z", carbonIntensity: 500 }]; // 12 pm IST
    const pattern = hourlyPattern(forecast);
    expect(pattern[12]).toBe(500);
    expect(pattern[11]).toBeNull();
  });
});
