import { describe, expect, test } from "bun:test";
import { kwhForPercent, parseBatteryKwh, parsePercent, vehicleByKey, VEHICLE_GROUPS, VEHICLES } from "./vehicles";

describe("vehicles", () => {
  test("every preset has a unique key, a sensible battery and a known group", () => {
    expect(new Set(VEHICLES.map((vehicle) => vehicle.key)).size).toBe(VEHICLES.length);
    for (const vehicle of VEHICLES) {
      expect(parseBatteryKwh(vehicle.batteryKwh)).toBe(vehicle.batteryKwh);
      expect(VEHICLE_GROUPS.some((group) => group.kind === vehicle.kind)).toBe(true);
    }
    expect(vehicleByKey("tata-nexon-45")?.batteryKwh).toBe(45);
    expect(vehicleByKey("nope")).toBeNull();
    expect(vehicleByKey(undefined)).toBeNull();
  });

  test("kWh from the grid for a battery % gain, with charging losses", () => {
    // 60% of 45 kWh is 27 kWh into the battery, 30 kWh from the socket.
    expect(kwhForPercent(45, 20, 80)).toBe(30);
    expect(kwhForPercent(3.7, 10, 100)).toBe(3.7);
    expect(kwhForPercent(45, 80, 20)).toBeNull();
    expect(kwhForPercent(45, 50, 50)).toBeNull();
    expect(kwhForPercent(45, -5, 50)).toBeNull();
    expect(kwhForPercent(45, 10, 120)).toBeNull();
  });

  test("parsing", () => {
    expect(parsePercent("20")).toBe(20);
    expect(parsePercent("20.6")).toBe(21);
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("")).toBeNull();
    expect(parseBatteryKwh("40.5")).toBe(40.5);
    expect(parseBatteryKwh("0.5")).toBeNull();
    expect(parseBatteryKwh("abc")).toBeNull();
  });
});
