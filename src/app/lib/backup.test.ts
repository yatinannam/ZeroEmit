import { describe, expect, test } from "bun:test";
import { backupFilename, makeBackup, parseBackup, restorePlan } from "./backup";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const charges = JSON.stringify([{ id: "a", energyKwh: 10 }, { id: "b", energyKwh: 12 }]);
const membership = (id: string) => JSON.stringify({ id, key: `${id}-key`, name: "Asha" });

describe("makeBackup", () => {
  test("keeps ZeroEmit's data and leaves out per-device keys and other apps' keys", () => {
    const backup = makeBackup([
      ["zeroemit-charges", charges],
      ["zeroemit-profile", JSON.stringify({ name: "Asha", vehicle: "Ather 450X" })],
      ["zeroemit-push-active", "1"],
      ["zeroemit-leaderboard-synced", "{}"],
      ["someone-else", "x"],
    ], NOW);
    expect(Object.keys(backup.data).sort()).toEqual(["zeroemit-charges", "zeroemit-profile"]);
    expect(backup).toMatchObject({ app: "zeroemit", version: 1, exportedAt: "2026-11-04T10:00:00.000Z" });
    expect(backupFilename(NOW)).toBe("zeroemit-backup-2026-11-04.json");
  });
});

describe("parseBackup", () => {
  const file = JSON.stringify(makeBackup([["zeroemit-charges", charges], ["zeroemit-profile", JSON.stringify({ name: "Asha", vehicle: "Ather 450X" })]], NOW));

  test("reads a backup and says what's in it", () => {
    const parsed = parseBackup(file);
    expect(parsed).toMatchObject({ ok: true, charges: 2, name: "Asha", vehicle: "Ather 450X" });
  });

  test("refuses other files, newer versions and huge files", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: "other", version: 1, data: {} })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: "zeroemit", version: 99, data: {} }))).toEqual({ ok: false, error: "This backup is from a newer version of ZeroEmit. Update the app, then try again." });
    expect(parseBackup("x".repeat(2_000_001)).ok).toBe(false);
  });

  test("drops keys it doesn't own and values that aren't strings", () => {
    const parsed = parseBackup(JSON.stringify({ app: "zeroemit", version: 1, data: { "zeroemit-charges": charges, "zeroemit-push-active": "1", "evil": "x", "zeroemit-profile": 7 } }));
    expect(parsed.ok && Object.keys(parsed.backup.data)).toEqual(["zeroemit-charges"]);
  });
});

describe("restorePlan", () => {
  test("replaces ZeroEmit's data and keeps per-device keys", () => {
    const backup = makeBackup([["zeroemit-charges", charges]], NOW);
    const plan = restorePlan({ "zeroemit-charges": "[]", "zeroemit-profile": "{}", "zeroemit-push-active": "1", "other-app": "x" }, backup);
    expect(plan.set).toEqual({ "zeroemit-charges": charges });
    expect(plan.remove).toEqual(["zeroemit-profile"]);
  });

  test("an entry only this device had is queued to leave the board", () => {
    const backup = makeBackup([["zeroemit-leaderboard", membership("old")]], NOW);
    const plan = restorePlan({ "zeroemit-leaderboard": membership("new") }, backup);
    expect(JSON.parse(plan.set["zeroemit-leaderboard-pending-leave"])).toEqual([{ id: "new", key: "new-key" }]);
    // The same entry in both: nothing to leave.
    expect(restorePlan({ "zeroemit-leaderboard": membership("old") }, backup).set["zeroemit-leaderboard-pending-leave"]).toBeUndefined();
  });
});
