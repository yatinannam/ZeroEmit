import { describe, expect, test } from "bun:test";
import { dayHeading } from "./personalization";

describe("dayHeading", () => {
  const now = new Date(2026, 10, 5, 9, 0);
  test("today, yesterday, then the date", () => {
    expect(dayHeading(new Date(2026, 10, 5, 1, 0).toISOString(), now)).toBe("Today");
    expect(dayHeading(new Date(2026, 10, 4, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayHeading(new Date(2026, 9, 30, 12, 0).toISOString(), now)).toBe("Fri, 30 Oct");
  });
  test("another year says which, and a missing date says earlier", () => {
    expect(dayHeading(new Date(2025, 11, 30, 12, 0).toISOString(), now)).toBe("Tue, 30 Dec, 2025");
    expect(dayHeading(new Date(0).toISOString(), now)).toBe("Earlier");
  });
});
