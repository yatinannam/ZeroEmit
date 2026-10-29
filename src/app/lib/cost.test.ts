import { describe, expect, test } from "bun:test";
import { chargeCost, DEFAULT_PRICE_PER_KWH, formatRupees, parsePricePerKwh } from "./cost";

describe("chargeCost", () => {
  test("kWh times the price, to the nearest rupee", () => {
    expect(chargeCost(22.5, 8)).toBe(180);
    expect(chargeCost(18.3, 7.5)).toBe(137);
  });

  test("a typical home tariff when no price is set", () => {
    expect(DEFAULT_PRICE_PER_KWH).toBe(8);
    expect(chargeCost(10)).toBe(80);
  });
});

describe("formatRupees", () => {
  test("Indian digit grouping", () => {
    expect(formatRupees(180)).toBe("₹180");
    expect(formatRupees(125000)).toBe("₹1,25,000");
  });
});

describe("parsePricePerKwh", () => {
  test("accepts ₹1-60 per kWh, rounded to paise", () => {
    expect(parsePricePerKwh("7.5")).toBe(7.5);
    expect(parsePricePerKwh(" 18.256 ")).toBe(18.26);
    expect(parsePricePerKwh(60)).toBe(60);
  });

  test("anything else means not set", () => {
    for (const bad of ["", "abc", "0", "0.5", "61", "-3", null, undefined]) expect(parsePricePerKwh(bad)).toBeNull();
  });
});
