import { describe, expect, test } from "bun:test";
import { pointsForCharge } from "../lib/rewards";
import { normalizeCharge, type Charge } from "./use-charges";

// 10 pm IST on 10 Oct 2026, 10 kWh at 600 gCO2/kWh.
const base: Charge = { id: "a", energyKwh: 10, chargedAt: "22:00", city: "Pune, Maharashtra", carbonIntensity: 600, loggedAt: "2026-10-10T16:30:00.000Z" };
const pad = (value: number) => String(value).padStart(2, "0");

describe("normalizeCharge", () => {
  test("keeps the timings the app writes", () => {
    for (const timing of ["best", "cleaner", "other"] as const) expect(normalizeCharge({ ...base, timing }).timing).toBe(timing);
  });

  test("drops any other timing (from a corrupted or hand-edited backup), so the charge counts as untimed", () => {
    for (const timing of ["superb", "constructor", "__proto__", "toString", 5, null, {}]) {
      const charge = normalizeCharge({ ...base, timing } as unknown as Charge);
      expect(Object.hasOwn(charge, "timing")).toBe(false);
      expect(pointsForCharge(charge)).toBe(10);
    }
  });

  test("rebuilds a time of day that isn't one from when the charge happened", () => {
    const local = new Date(base.loggedAt);
    const rebuilt = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
    for (const chargedAt of ["24:00", "25:00", "12:60", "99:99", "7", 2200]) expect(normalizeCharge({ ...base, chargedAt } as unknown as Charge).chargedAt).toBe(rebuilt);
    for (const chargedAt of ["00:00", "9:05", "19:30", "23:59"]) expect(normalizeCharge({ ...base, chargedAt }).chargedAt).toBe(chargedAt);
  });
});
