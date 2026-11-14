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

describe("resetNotificationPrefs", () => {
  test("leaves every kind off, so a device whose permission outlives \"Delete my data\" isn't quietly subscribed again", async () => {
    const { NOTIFICATION_KINDS, notificationPrefEnabled, resetNotificationPrefs } = await import("./notifications");
    resetNotificationPrefs();
    expect(NOTIFICATION_KINDS.filter((kind) => notificationPrefEnabled(kind.key))).toEqual([]);
  });
});

describe("requestNotificationPermission", () => {
  // A stand-in Notification whose prompt gets the given answer.
  async function ask(answer: NotificationPermission) {
    const saved = { window: (globalThis as { window?: unknown }).window, Notification: (globalThis as { Notification?: unknown }).Notification };
    const fake = { permission: "default" as NotificationPermission, requestPermission: async () => { fake.permission = answer; return answer; } };
    Object.assign(globalThis, { window: globalThis, Notification: fake });
    try {
      const { requestNotificationPermission, subscribeToPermission } = await import("./notifications");
      let changes = 0;
      const unsubscribe = subscribeToPermission(() => { changes += 1; });
      const result = await requestNotificationPermission();
      unsubscribe();
      return { ...result, changes };
    } finally {
      for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete (globalThis as Record<string, unknown>)[name]; else Object.assign(globalThis, { [name]: value }); }
    }
  }

  test("a dismissed prompt refreshes the permission UI and says to try again, not to visit site settings", async () => {
    const { DISMISSED_MESSAGE } = await import("./notifications");
    expect(await ask("default")).toEqual({ granted: false, message: DISMISSED_MESSAGE, changes: 1 });
  });

  test("a denied prompt refreshes the permission UI too", async () => {
    const result = await ask("denied");
    expect(result).toMatchObject({ granted: false, changes: 1 });
    expect(result.message).toContain("site settings");
  });
});
