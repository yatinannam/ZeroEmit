import { describe, expect, test } from "bun:test";
import { forEachLimited } from "./pool";

describe("forEachLimited", () => {
  test("handles every item, never more than `limit` at once", async () => {
    let running = 0, peak = 0;
    const seen: number[] = [];
    await forEachLimited(Array.from({ length: 25 }, (_, i) => i), 5, async (item) => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 + (item % 3)));
      seen.push(item); running -= 1;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(peak).toBe(5);
  });

  test("one failing item doesn't stop the rest", async () => {
    const seen: number[] = [];
    await forEachLimited([1, 2, 3], 2, async (item) => { if (item === 2) throw new Error("boom"); seen.push(item); });
    expect(seen.sort()).toEqual([1, 3]);
  });
});
