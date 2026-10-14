import { describe, expect, test } from "bun:test";
import type { Charge } from "../components/use-charges";
import { achievements, chargeOutcome } from "./rewards";

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
