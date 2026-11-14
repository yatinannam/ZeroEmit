import { describe, expect, test } from "bun:test";
import { chargeCost, DEFAULT_PRICE_PER_KWH, formatRupees, parsePricePerKwh, priceError } from "./cost";

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

describe("priceError", () => {
  test("a blank price or one from ₹1 to ₹60 can be saved", () => {
    for (const ok of ["", " ", "1", "7.5", "18.256", "60"]) expect(priceError(ok)).toBeNull();
    // Whatever priceError lets through, parsePricePerKwh keeps (or clears, when blank).
    for (const ok of ["1", "7.5", "18.256", "60"]) expect(parsePricePerKwh(ok)).not.toBeNull();
  });

  test("each way a price can't be saved gets its own message", () => {
    expect(priceError("NaN")).toBe("Enter the price as a number, like 7.5.");
    for (const low of ["0", "0.5", "-3"]) expect(priceError(low)).toBe("Enter at least ₹1 per kWh, or leave it blank to use ₹8.");
    for (const high of ["61", "60.5", "9999"]) expect(priceError(high)).toBe("Enter ₹60 per kWh or less, or leave it blank to use ₹8.");
  });
});
