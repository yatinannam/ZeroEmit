import { describe, expect, test } from "bun:test";
import { parsePrefs } from "./notifications";

describe("parsePrefs", () => {
  test("someone who had every scheduled notification off doesn't get the new ones switched on", () => {
    const prefs = parsePrefs(JSON.stringify({ charges: true, rewards: true, bestTime: false, dailyDigest: false, streakReminders: false }));
    expect(prefs).toMatchObject({ leaderboard: false, progress: false });
  });

  test("anyone with a scheduled notification on gets the new ones on", () => {
    expect(parsePrefs(JSON.stringify({ bestTime: true, dailyDigest: false, streakReminders: false }))).toMatchObject({ leaderboard: true, progress: true });
  });

  test("choices already made for the new switches are kept", () => {
    expect(parsePrefs(JSON.stringify({ bestTime: false, dailyDigest: false, streakReminders: false, leaderboard: true, progress: false }))).toMatchObject({ leaderboard: true, progress: false });
  });
});
