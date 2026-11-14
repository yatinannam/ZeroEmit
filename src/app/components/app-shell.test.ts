import { describe, expect, test } from "bun:test";
import { celebratePoints, onCelebratePoints } from "./app-shell";

describe("celebratePoints", () => {
  test("reaches the top bar only when points were earned", () => {
    const heard: number[] = [];
    const stop = onCelebratePoints((gained) => heard.push(gained));
    celebratePoints(15);
    celebratePoints(0);
    stop();
    celebratePoints(5);
    expect(heard).toEqual([15]);
  });
});
