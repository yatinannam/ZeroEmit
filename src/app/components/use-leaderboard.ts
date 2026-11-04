"use client";

import { useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import type { Charge } from "./use-charges";
import { alternativeName, istMonthKey, toLeaderboardCharges } from "../lib/leaderboard";
import type { Zone } from "../lib/places";

// This device's leaderboard entry: a public id, the secret key that proves the
// entry is ours (the server keeps only its hash), and the display name.
export type Membership = { id: string; key: string; name: string };

const store = createLocalStorageStore<Membership | null>(
  "zeroemit-leaderboard",
  (raw) => {
    const value = JSON.parse(raw) as Partial<Membership> | null;
    return value && typeof value.id === "string" && typeof value.key === "string" && typeof value.name === "string" ? { id: value.id, key: value.key, name: value.name } : null;
  },
  (value) => JSON.stringify(value),
  null,
);

export function useLeaderboardMembership() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

// The membership outside React (group calls need its id and key).
export const getLeaderboardMembership = () => store.getSnapshot();

function submit(membership: Membership, zone: Zone, charges: Charge[]) {
  return fetch("/api/leaderboard/member", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...membership, zone, charges: toLeaderboardCharges(charges, istMonthKey(Date.now())) }),
  });
}

// The id and key for a join in progress, kept until a join succeeds: if the
// server saved a join but the response was lost, trying again reuses them
// instead of creating a second entry.
const PENDING_JOIN_KEY = "zeroemit-leaderboard-pending-join";
function storedPendingJoin(): { id: string; key: string } | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PENDING_JOIN_KEY) ?? "null") as { id?: unknown; key?: unknown } | null;
    if (stored && typeof stored.id === "string" && typeof stored.key === "string") return { id: stored.id, key: stored.key };
  } catch { /* unreadable: treated as none */ }
  return null;
}
function pendingJoin(): { id: string; key: string } {
  const stored = storedPendingJoin();
  if (stored) return stored;
  const fresh = { id: crypto.randomUUID(), key: crypto.randomUUID() };
  try { window.localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify(fresh)); } catch { /* storage unavailable */ }
  return fresh;
}
function forgetPendingJoin() {
  try { window.localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* storage unavailable */ }
}

// Joins, or (already a member) renames this device's entry: the server treats
// a new name under the same id and key as a rename, with the same rules as
// joining (valid, and not held by anyone else this month). `points` is this
// month's score as the server counted it.
export async function joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<{ ok: true; rank: number; points: number } | { ok: false; error: string }> {
  const current = store.getSnapshot();
  const { id, key } = current ?? pendingJoin();
  const membership: Membership = { id, key, name };
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) {
      const { code } = await response.json().catch(() => ({})) as { code?: string };
      const suggestion = alternativeName(name);
      const error = code === "name" ? "That name can't be used. Try another one."
        : code === "name-taken" ? `That name is already on this month's leaderboard. Try another${suggestion ? `, like "${suggestion}"` : ""}.`
        : response.status === 429 ? "Too many updates. Try again in a while." : current ? "Couldn't change your name. Try again." : "Couldn't join the leaderboard. Try again.";
      return { ok: false, error };
    }
    const body = await response.json() as { rank: number; points?: number };
    store.write(membership);
    // The join already sent this score; don't send it again straight away.
    rememberSynced(syncFingerprint(membership, zone, charges));
    forgetPendingJoin();
    return { ok: true, rank: body.rank, points: body.points ?? 0 };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

// The toast after joining. A rank only once there's a point to rank by:
// until then the board doesn't list the member (see readLeaderboard).
export function joinedMessage({ rank, points }: { rank: number; points: number }) {
  return points > 0 ? `You're #${rank} on the leaderboard this month` : "You're in. Log a charge this month to appear on the board.";
}

// Shown when a sync finds this device's entry gone from the server.
export const ENTRY_GONE_MESSAGE = "Your leaderboard entry is no longer on the board. Join again from Rewards to get back on.";

// Bumped after each sync the server accepts, so an open board refetches and
// shows the new score (the sync runs a moment after a charge is logged).
let version = 0;
const versionListeners = new Set<() => void>();
export function getLeaderboardVersion() { return version; }
function subscribeToVersion(listener: () => void) {
  versionListeners.add(listener);
  return () => { versionListeners.delete(listener); };
}
export function useLeaderboardVersion() {
  return useSyncExternalStore(subscribeToVersion, getLeaderboardVersion, () => 0);
}

// Resolves to false when the update didn't go through (offline, rate limit,
// server error), so the caller can try again later.
// What was last sent successfully, so opening the app doesn't re-send an
// unchanged score (each update costs a dozen Redis commands on a free tier).
// Re-sent anyway after a few hours, to pick up a new month or a lost entry.
const SYNCED_KEY = "zeroemit-leaderboard-synced";
const RESYNC_AFTER_MS = 6 * 60 * 60_000;

function syncFingerprint(membership: Membership, zone: Zone, charges: Charge[]) {
  return JSON.stringify([membership.id, membership.name, zone, toLeaderboardCharges(charges, istMonthKey(Date.now()))]);
}

function rememberSynced(fingerprint: string) {
  try { window.localStorage.setItem(SYNCED_KEY, JSON.stringify({ fingerprint, at: Date.now() })); } catch { /* storage unavailable */ }
}

// Resolves to "gone" (also nothing to retry) when the server no longer has
// this entry, so the caller can say so.
export async function syncLeaderboard(zone: Zone, charges: Charge[]): Promise<boolean | "gone"> {
  const membership = store.getSnapshot();
  if (!membership) return true;
  const fingerprint = syncFingerprint(membership, zone, charges);
  try {
    const last = JSON.parse(window.localStorage.getItem(SYNCED_KEY) ?? "null") as { fingerprint?: string; at?: number } | null;
    if (last?.fingerprint === fingerprint && Date.now() - (last.at ?? 0) < RESYNC_AFTER_MS) return true;
  } catch { /* unreadable: just send */ }
  try {
    const response = await submit(membership, zone, charges);
    // 410: this entry already left (e.g. from another tab), so forget it here too.
    if (response.status === 410) { store.write(null); return true; }
    // 404, or 409 for a record that expired (RETENTION_S on the server) while
    // someone else took its name: syncing again can't bring it back. Forget it
    // here, and remove it in case the server does still hold it after all.
    if (response.status === 404 || response.status === 409) {
      store.write(null);
      void leaveEntries([{ id: membership.id, key: membership.key }]);
      return "gone";
    }
    if (!response.ok) return false;
    rememberSynced(fingerprint);
    version += 1;
    versionListeners.forEach((listener) => listener());
    return true;
  } catch {
    return false;
  }
}

// Entries this device has left but the server hasn't confirmed removing yet.
// Each holds the only copy of its key, so it's kept until the removal goes
// through — otherwise the name would stay public with no way to take it down.
type PendingLeave = { id: string; key: string };
const NO_PENDING: PendingLeave[] = [];
const isPendingLeave = (value: unknown): value is PendingLeave =>
  Boolean(value && typeof value === "object" && typeof (value as PendingLeave).id === "string" && typeof (value as PendingLeave).key === "string");
const pendingLeaves = createLocalStorageStore<PendingLeave[]>(
  "zeroemit-leaderboard-pending-leave",
  (raw) => {
    const value: unknown = JSON.parse(raw);
    // Older versions stored a single entry rather than a list.
    const list = Array.isArray(value) ? value : [value];
    return list.filter(isPendingLeave).map(({ id, key }) => ({ id, key }));
  },
  (value) => JSON.stringify(value),
  NO_PENDING,
);

// True once there's nothing left to retry: removed, or refused for good
// (400/403 — not something a retry could change).
async function sendLeave(entry: PendingLeave) {
  try {
    const response = await fetch("/api/leaderboard/member", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
    return response.ok || response.status === 400 || response.status === 403;
  } catch {
    return false;
  }
}

// Queues each entry's removal, then tries it now; whether all went through.
async function leaveEntries(entries: PendingLeave[]) {
  pendingLeaves.write([...pendingLeaves.getSnapshot(), ...entries]);
  const outcomes = await Promise.all(entries.map(sendLeave));
  const done = new Set(entries.filter((_, index) => outcomes[index]).map((entry) => entry.id));
  pendingLeaves.write(pendingLeaves.getSnapshot().filter((pending) => !done.has(pending.id)));
  return outcomes.every(Boolean);
}

// Forgets the entry on this device at once, so the UI updates; the removal is
// retried (see retryPendingLeave) until the server confirms it. Resolves to
// whether it went through now.
// A join the server saved but whose answer never arrived exists only as the
// pending join's id and key, so that one is removed too ("Delete my data"
// must not leave it public).
export async function leaveLeaderboard() {
  const membership = store.getSnapshot();
  const entries = [membership, storedPendingJoin()]
    .filter((entry) => entry !== null)
    .map(({ id, key }) => ({ id, key }))
    .filter((entry, index, list) => list.findIndex((other) => other.id === entry.id) === index);
  if (!entries.length) return true;
  store.write(null);
  forgetPendingJoin();
  return leaveEntries(entries);
}

export async function retryPendingLeave() {
  const pending = pendingLeaves.getSnapshot();
  if (!pending.length) return;
  const outcomes = await Promise.all(pending.map(sendLeave));
  const done = new Set(pending.filter((_, index) => outcomes[index]).map((entry) => entry.id));
  pendingLeaves.write(pendingLeaves.getSnapshot().filter((entry) => !done.has(entry.id)));
}
