import { istDayKey } from "./grid";

// Backups: everything ZeroEmit keeps on the device, in one JSON file, so a
// driver can keep it safe or move to a new phone. There are no accounts, so
// this file is the only copy of the charge history and the leaderboard key.
export const BACKUP_APP = "zeroemit";
export const BACKUP_VERSION = 1;
const PREFIX = "zeroemit-";
// Big enough for years of charges, small enough to refuse a wrong file early.
export const MAX_BACKUP_BYTES = 2_000_000;

// Kept per device, never carried over: push subscriptions belong to this
// browser, the rest are reminders of what this device already did, and a
// join or key swap still in progress belongs to the device that started it.
export const DEVICE_ONLY_KEYS = new Set([
  "zeroemit-push-active",
  "zeroemit-clean-alert",
  "zeroemit-leaderboard-synced",
  "zeroemit-install-dismissed",
  "zeroemit-last-backup",
  "zeroemit-leaderboard-pending-join",
  "zeroemit-leaderboard-rekey",
]);
const PENDING_LEAVE_KEY = "zeroemit-leaderboard-pending-leave";
const MEMBERSHIP_KEY = "zeroemit-leaderboard";
// The new key a restored entry moves to (see syncLeaderboard).
const REKEY_KEY = "zeroemit-leaderboard-rekey";
export const BACKUP_TOO_BIG = "That file is too big to be a ZeroEmit backup.";

export type Backup = { app: typeof BACKUP_APP; version: number; exportedAt: string; data: Record<string, string> };
export const isBackupKey = (key: string) => key.startsWith(PREFIX) && !DEVICE_ONLY_KEYS.has(key);

// The backup of `entries` (every localStorage key and value).
export function makeBackup(entries: [string, string][], now = Date.now()): Backup {
  const data: Record<string, string> = {};
  for (const [key, value] of entries) if (isBackupKey(key)) data[key] = value;
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), data };
}

// Named by the IST date, like everything else in the app.
export const backupFilename = (now = Date.now()) => `zeroemit-backup-${istDayKey(now)}.json`;

export type ParsedBackup = { ok: true; backup: Backup; charges: number; name: string; vehicle: string } | { ok: false; error: string };

const json = (raw: string | undefined) => { try { return raw === undefined ? undefined : JSON.parse(raw) as unknown; } catch { return undefined; } };

// A file the user picked, checked before anything on the device changes.
export function parseBackup(text: string): ParsedBackup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) return { ok: false, error: BACKUP_TOO_BIG };
  const parsed = json(text) as Partial<Backup> | undefined;
  if (!parsed || typeof parsed !== "object" || parsed.app !== BACKUP_APP || typeof parsed.data !== "object" || parsed.data === null) return { ok: false, error: "That isn't a ZeroEmit backup file." };
  if (typeof parsed.version !== "number" || parsed.version > BACKUP_VERSION) return { ok: false, error: "This backup is from a newer version of ZeroEmit. Update the app, then try again." };
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!isBackupKey(key) || typeof value !== "string") continue;
    data[key] = value;
  }
  const charges = json(data["zeroemit-charges"]);
  const profile = json(data["zeroemit-profile"]) as { name?: unknown; vehicle?: unknown } | undefined;
  return {
    ok: true,
    // A date only when it is one (the file may have been edited by hand).
    backup: { app: BACKUP_APP, version: parsed.version, exportedAt: typeof parsed.exportedAt === "string" && !Number.isNaN(Date.parse(parsed.exportedAt)) ? parsed.exportedAt : "", data },
    charges: Array.isArray(charges) ? charges.length : 0,
    name: typeof profile?.name === "string" ? profile.name : "",
    vehicle: typeof profile?.vehicle === "string" ? profile.vehicle : "",
  };
}

type Entry = { id: string; key: string };
const isEntry = (value: unknown): value is Entry => Boolean(value && typeof value === "object" && typeof (value as Entry).id === "string" && typeof (value as Entry).key === "string");

const entries = (raw: string | undefined) => { const value = json(raw); return (Array.isArray(value) ? value : [value]).filter(isEntry); };

// What the device's storage should hold after restoring `backup` over
// `current` (its own keys and values): the backup's data, the device-only
// keys kept, and everything else of ZeroEmit's removed.
// - Removals still waiting to reach the server, this device's and the
//   backup's, are all kept: each holds the only copy of its key.
// - A leaderboard entry this device had that the backup doesn't is queued to
//   leave, so it isn't left on the public board with nobody holding its key.
// - The backup's entry moves to `newKey` on the next sync, so the phone the
//   backup came from can no longer remove or overwrite it. If this device
//   already holds that entry, it keeps its own (newer) key instead.
export function restorePlan(current: Record<string, string>, backup: Backup, newKey: string): { set: Record<string, string>; remove: string[] } {
  const set = { ...backup.data };
  const remove = Object.keys(current).filter((key) => isBackupKey(key) && !(key in set));
  const [mine] = entries(current[MEMBERSHIP_KEY]);
  const [theirs] = entries(set[MEMBERSHIP_KEY]);
  const leaving = [...entries(set[PENDING_LEAVE_KEY]), ...entries(current[PENDING_LEAVE_KEY])];
  if (mine && mine.id !== theirs?.id) leaving.push(mine);
  const unique = leaving.filter((entry, index) => leaving.findIndex((other) => other.id === entry.id) === index).map(({ id, key }) => ({ id, key }));
  if (unique.length) set[PENDING_LEAVE_KEY] = JSON.stringify(unique);
  if (theirs && mine?.id === theirs.id) set[MEMBERSHIP_KEY] = current[MEMBERSHIP_KEY];
  else if (theirs) set[REKEY_KEY] = newKey;
  else if (REKEY_KEY in current) remove.push(REKEY_KEY);
  return { set, remove: remove.filter((key) => !(key in set)) };
}
