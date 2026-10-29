import { describe, expect, test } from "bun:test";
import { chartDomain } from "./forecast-chart";

describe("chartDomain", () => {
  test("a small spread stays a small wiggle instead of filling the chart", () => {
    // 821 vs 846 is a 3% difference; it shouldn't be drawn floor-to-ceiling.
    const [low, high] = chartDomain([821, 846, 846]);
    expect((821 - low) / (high - low)).toBeGreaterThan(0.6);
  });

  test("a real daily swing keeps its shape", () => {
    const [low, high] = chartDomain([450, 600, 850]);
    expect(low).toBeLessThan(450);
    expect(high).toBeGreaterThanOrEqual(850);
    expect((450 - low) / (high - low)).toBeLessThan(0.5);
  });

  test("never goes below zero", () => {
    expect(chartDomain([20, 60])[0]).toBe(0);
  });

  test("a flat line still has a range", () => {
    const [low, high] = chartDomain([500, 500]);
    expect(high).toBeGreaterThan(low);
  });
});
