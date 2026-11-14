import { describe, expect, test } from "bun:test";
import { formatUpdatedAt, HOUR_MS, intensityAt, istDayKey, istHourOfDay, istHourStart, liveReading, planByDay, planNext24, relativeDay, intensityLevel, topWindows, type GridData } from "./grid";
import { chargeTiming, hourlyPattern, isBestWindowStart } from "./timing";

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
    expect(formatUpdatedAt("2026-11-03T08:00:00+05:30", now)).toBe("8:00\u00a0am");
  });

  test("yesterday's says so", () => {
    expect(formatUpdatedAt("2026-11-02T18:00:00+05:30", now)).toBe("yesterday, 6:00\u00a0pm");
  });

  test("older ones get the date", () => {
    expect(formatUpdatedAt("2026-11-01T18:00:00+05:30", now)).toBe("1 Nov, 6:00\u00a0pm");
  });

  test("never in the future", () => {
    expect(formatUpdatedAt("2026-11-03T11:00:00+05:30", now)).toBe("10:00\u00a0am");
  });
});

describe("planNext24", () => {
  // 9 pm IST: today has 3 hours left, the clean dip is at noon tomorrow.
  const now = Date.parse("2026-11-04T15:30:00Z");
  const forecast = Array.from({ length: 30 }, (_, i) => {
    const at = istHourStart(now) + i * HOUR_MS;
    const hour = new Date(at + 5.5 * HOUR_MS).getUTCHours();
    return { datetime: new Date(at).toISOString(), carbonIntensity: hour === 12 || hour === 13 ? 400 : 700 };
  });
  const data: GridData = { available: true, state: "maharashtra", forecast, forecastIsTypical: true, source: "test" };

  test("covers the next 24 hours and finds tomorrow's dip", () => {
    const plan = planNext24(data, now);
    expect(plan.points).toHaveLength(24);
    expect(plan.windows[0].average).toBe(400);
    expect(relativeDay(Date.parse(plan.windows[0].start.datetime), now)).toBe("Tomorrow");
  });

  test("nothing without data", () => {
    expect(planNext24(null, now)).toEqual({ points: [], windows: [] });
  });

  test("relativeDay", () => {
    expect(relativeDay(now + HOUR_MS, now)).toBe("Tonight");
    expect(relativeDay(Date.parse("2026-11-04T05:30:00Z"), now)).toBe("Today");
    expect(relativeDay(now + 20 * HOUR_MS, now)).toBe("Tomorrow");
    expect(relativeDay(now + 60 * HOUR_MS, now)).toBe("");
    // 9 pm: 2 am is tonight. 12:10 am: 2 am is this morning, and noon is today.
    expect(relativeDay(Date.parse("2026-11-04T20:30:00Z"), now)).toBe("Tonight");
    const pastMidnight = Date.parse("2026-11-04T18:40:00Z");
    expect(relativeDay(Date.parse("2026-11-04T20:30:00Z"), pastMidnight)).toBe("This morning");
    expect(relativeDay(Date.parse("2026-11-05T06:30:00Z"), pastMidnight)).toBe("Today");
  });
});

describe("relativeDay label table", () => {
  // Seen from each time on 13 Nov (IST), the label for each start. A night
  // (6 pm to 6 am) has one label all through, and no two nights share one.
  const ist = (iso: string) => Date.parse(`${iso}+05:30`);
  const table: [now: string, starts: [string, string][]][] = [
    ["2026-11-13T10:00:00", [["13T14:00", "Today"], ["13T17:59", "Today"], ["13T18:00", "Tonight"], ["13T23:00", "Tonight"], ["14T02:00", "Tonight"], ["14T05:59", "Tonight"], ["14T06:00", "Tomorrow"], ["14T09:00", "Tomorrow"], ["14T20:00", "Tomorrow night"], ["15T02:00", "Tomorrow night"], ["15T09:00", ""]]],
    ["2026-11-13T18:00:00", [["13T18:30", "Tonight"], ["14T03:00", "Tonight"], ["14T12:00", "Tomorrow"], ["14T19:00", "Tomorrow night"]]],
    ["2026-11-13T22:00:00", [["13T23:00", "Tonight"], ["14T01:00", "Tonight"], ["14T12:00", "Tomorrow"], ["14T20:00", "Tomorrow night"], ["14T21:59", "Tomorrow night"]]],
    ["2026-11-13T23:00:00", [["14T01:00", "Tonight"], ["14T22:00", "Tomorrow night"]]],
    ["2026-11-13T00:10:00", [["13T02:00", "This morning"], ["13T12:00", "Today"], ["13T23:00", "Tonight"], ["13T23:59", "Tonight"]]],
    ["2026-11-13T01:00:00", [["13T03:00", "This morning"], ["13T05:59", "This morning"], ["13T06:00", "Today"], ["13T23:00", "Tonight"], ["14T00:30", "Tonight"]]],
    ["2026-11-13T05:30:00", [["13T05:45", "This morning"], ["13T12:00", "Today"], ["13T19:00", "Tonight"], ["14T05:00", "Tonight"]]],
    ["2026-11-13T06:00:00", [["13T07:00", "Today"], ["13T21:00", "Tonight"], ["14T05:00", "Tonight"]]],
  ];
  for (const [now, starts] of table) {
    test(`seen from ${now.slice(11, 16)}`, () => {
      expect(starts.map(([start]) => [start, relativeDay(ist(`2026-11-${start}:00`), ist(now))])).toEqual(starts);
    });
  }

  test("every night in the next 24 hours has one label, and none shares another's", () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
      const now = ist("2026-11-13T00:00:00") + minutes * 60_000;
      const byNight = new Map<string, Set<string>>();
      for (let at = istHourStart(now); at < now + 24 * HOUR_MS; at += HOUR_MS) {
        const hour = istHourOfDay(at);
        if (hour >= 6 && hour < 18) continue;
        // Each night keyed by the day of the 6 pm it starts at.
        const night = istDayKey(at - 6 * HOUR_MS);
        byNight.set(night, (byNight.get(night) ?? new Set()).add(relativeDay(at, now)));
      }
      const labels = [...byNight.values()];
      for (const set of labels) expect(set.size).toBe(1);
      expect(new Set(labels.map((set) => [...set][0])).size).toBe(labels.length);
    }
  });
});

describe("topWindows", () => {
  const ist = (iso: string) => Date.parse(`${iso}+05:30`);
  // A typical day projected from the current hour to the end of tomorrow, as the API sends it.
  const typicalDay = (pattern: number[], now: number): GridData => {
    const from = istHourStart(now);
    const forecast = Array.from({ length: 48 - istHourOfDay(from) }, (_, i) => ({ datetime: new Date(from + i * HOUR_MS).toISOString(), carbonIntensity: pattern[istHourOfDay(from + i * HOUR_MS)] }));
    return { available: true, state: "maharashtra", forecast, forecastIsTypical: true, source: "test" };
  };

  test("a window never spans a missing hour", () => {
    // Hours 0, 1, 5, 6, 7: 1 am and 5 am aren't a 2-hour window, and the
    // window at midnight ends at 2 am, not at the next point (5 am).
    const forecast = [0, 1, 5, 6, 7].map((hour, i) => ({ datetime: new Date(ist("2026-11-13T00:00:00") + hour * HOUR_MS).toISOString(), carbonIntensity: [700, 300, 300, 700, 700][i] }));
    const windows = topWindows(forecast, 2, 3);
    expect(windows.map((w) => [w.start.datetime, w.end.datetime])).toEqual([
      [forecast[0].datetime, new Date(ist("2026-11-13T02:00:00")).toISOString()],
      [forecast[2].datetime, forecast[4].datetime],
    ]);
  });

  test("a typical day doesn't list the same clock hours twice", () => {
    // Cleanest around 1 pm; at 2:40 pm today's 2 pm and tomorrow's are one window.
    const pattern = Array.from({ length: 24 }, (_, h) => Math.round((720 - 160 * Math.exp(-((h - 13) ** 2) / 6)) * 10) / 10);
    for (const now of [ist("2026-11-13T14:40:00"), ist("2026-11-13T13:20:00"), ist("2026-11-13T10:10:00")]) {
      const hours = planNext24(typicalDay(pattern, now), now).windows.map((w) => istHourOfDay(Date.parse(w.start.datetime)));
      expect(hours).toHaveLength(3);
      for (const a of hours) for (const b of hours) if (a !== b) expect(Math.min(Math.abs(a - b), 24 - Math.abs(a - b))).toBeGreaterThanOrEqual(2);
      expect(new Set(hours).size).toBe(3);
    }
  });

  test("every window listed from a typical day earns the best-window bonus", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 2000; trial += 1) {
      // Rounded, so ties between hours come up too.
      const pattern = Array.from({ length: 24 }, () => Math.round(550 + random() * 25) * 10);
      const now = ist("2026-11-13T00:00:00") + Math.floor(random() * 24 * 60) * 60_000;
      const data = typicalDay(pattern, now);
      const windows = planNext24(data, now).windows;
      const hourly = hourlyPattern(data.forecast);
      expect(windows).toHaveLength(3);
      for (const window of windows) {
        const hour = istHourOfDay(Date.parse(window.start.datetime));
        expect(chargeTiming(hourly, hour)).toBe("best");
        expect(isBestWindowStart(hourly, hour)).toBe(true);
      }
    }
  });

  test("a live forecast can list the same hour today and tomorrow", () => {
    const now = ist("2026-11-13T13:20:00");
    const forecast = Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(istHourStart(now) + i * HOUR_MS).toISOString(), carbonIntensity: i % 24 === 0 || i % 24 === 1 ? 300 : 700 }));
    const starts = topWindows(forecast, 2, 3).map((w) => w.start.datetime);
    expect(starts.slice(0, 2)).toEqual([forecast[0].datetime, forecast[24].datetime]);
  });
});

describe("intensityLevel", () => {
  const day = Array.from({ length: 24 }, (_, hour) => 400 + hour * 10); // 400 … 630
  test("thirds of the region's own day", () => {
    expect(intensityLevel(410, day)).toBe("low");
    expect(intensityLevel(520, day)).toBe("average");
    expect(intensityLevel(600, day)).toBe("high");
    expect(intensityLevel(900, day)).toBe("high");
    expect(intensityLevel(100, day)).toBe("low");
  });
  test("no label without enough of a day to compare with", () => {
    expect(intensityLevel(500, null)).toBeNull();
    expect(intensityLevel(500, [400, 500, null, null])).toBeNull();
  });
});
