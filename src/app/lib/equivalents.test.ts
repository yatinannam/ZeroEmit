import { describe, expect, test } from "bun:test";
import { equivalentsSentence, impactEquivalents } from "./equivalents";

describe("impactEquivalents", () => {
  test("km not driven in a petrol car (150 g/km) and tree-years (21 kg/year)", () => {
    expect(impactEquivalents(61)).toEqual({ petrolKm: 407, treeYears: 2.9 });
  });
});

describe("equivalentsSentence", () => {
  test("both comparisons once there's at least a tree-year", () => {
    expect(equivalentsSentence(61)).toBe("Like not driving 407 km in a petrol car, or what 2.9 trees absorb in a year.");
  });

  test("singular tree", () => {
    expect(equivalentsSentence(21)).toBe("Like not driving 140 km in a petrol car, or what 1 tree absorbs in a year.");
  });

  test("only the distance while it's under a tree-year", () => {
    expect(equivalentsSentence(4.5)).toBe("Like not driving 30 km in a petrol car.");
  });

  test("nothing to say for under 1 km", () => {
    expect(equivalentsSentence(0.05)).toBeNull();
    expect(equivalentsSentence(0)).toBeNull();
  });
});
