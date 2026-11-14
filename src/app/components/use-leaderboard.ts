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

// Bumped by every leave (Leave, or "Delete my data"), so a join or sync whose
// answer lands afterwards doesn't write the membership back here.
let leaveEpoch = 0;
// Joins and syncs still waiting on the server. A leave waits for them before
// sending its removal, so none of them can put the entry back after it.
const inFlight = new Set<Promise<unknown>>();
function tracked<T>(work: Promise<T>) {
  inFlight.add(work);
  const settle = () => { inFlight.delete(work); };
  void work.then(settle, settle);
  return work;
}

type JoinResult = { ok: true; rank: number; points: number } | { ok: false; error: string };

// A join that was on its way when the device left: the server may have saved
// it, so it's taken off again instead of being written back here.
async function leftDuringJoin(entry: PendingLeave): Promise<JoinResult> {
  await leaveAlso([entry]);
  return { ok: false, error: "You left the leaderboard before that went through." };
}

// Joins, or (already a member) renames this device's entry: the server treats
// a new name under the same id and key as a rename, with the same rules as
// joining (valid, and not held by anyone else this month). `points` is this
// month's score as the server counted it.
export function joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<JoinResult> {
  return tracked(join(name, zone, charges));
}

async function join(name: string, zone: Zone, charges: Charge[]): Promise<JoinResult> {
  const epoch = leaveEpoch;
  const current = store.getSnapshot();
  const { id, key } = current ?? pendingJoin();
  const membership: Membership = { id, key, name };
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) {
      const { code } = await response.json().catch(() => ({})) as { code?: string };
      if (leaveEpoch !== epoch) return leftDuringJoin({ id, key });
      const suggestion = alternativeName(name);
      const error = code === "name" ? "That name can't be used. Try another one."
        : code === "name-taken" ? `That name is already on this month's leaderboard. Try another${suggestion ? `, like "${suggestion}"` : ""}.`
        : response.status === 429 ? "Too many updates. Try again in a while." : current ? "Couldn't change your name. Try again." : "Couldn't join the leaderboard. Try again.";
      return { ok: false, error };
    }
    const body = await response.json() as { rank: number; points?: number };
    if (leaveEpoch !== epoch) return leftDuringJoin({ id, key });
    store.write(membership);
    // The join already sent this score; don't send it again straight away.
    rememberSynced(syncFingerprint(membership, zone, charges));
    forgetPendingJoin();
    return { ok: true, rank: body.rank, points: body.points ?? 0 };
  } catch {
    if (leaveEpoch !== epoch) return leftDuringJoin({ id, key });
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
// Shown when the entry's key no longer works here: a backup of it was
// restored on another phone, which took the entry over.
export const ENTRY_MOVED_MESSAGE = "Your leaderboard entry moved to another phone, where a backup was restored. Join again from Rewards to have one here too.";

// The server's answer when this key isn't the entry's (not a 403 from the
// same-site check, which says nothing about the entry).
const notYours = async (response: Response) => response.status === 403 && ((await response.clone().json().catch(() => ({}))) as { code?: string }).code === "not-yours";

// A restored backup carries the entry's key, so the phone it came from still
// holds the same key. The restore leaves a fresh key here (lib/backup's
// restorePlan), and the next sync swaps it in on the server: from then on the
// old phone's copy no longer works, so it can't remove or overwrite the entry
// it handed over.
const REKEY_KEY = "zeroemit-leaderboard-rekey";
function storedRekey() {
  try { return window.localStorage.getItem(REKEY_KEY); } catch { return null; }
}
function forgetRekey() {
  try { window.localStorage.removeItem(REKEY_KEY); } catch { /* storage unavailable */ }
}

// The membership under its new key; false to try again later; or why the
// entry can't be kept ("left" says nothing: it left on purpose). Left while
// the swap was on its way (`epoch` moved on): the entry may be under either
// key now, so it's removed under the new one too, and nothing is written back.
async function rekey(membership: Membership, newKey: string, epoch: number): Promise<Membership | false | "gone" | "moved" | "left"> {
  const leftMeanwhile = async () => { await leaveAlso([{ id: membership.id, key: newKey }]); return "left" as const; };
  try {
    const response = await fetch("/api/leaderboard/member", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: membership.id, key: membership.key, newKey }) });
    if (leaveEpoch !== epoch) return leftMeanwhile();
    if (response.ok) {
      const moved = { ...membership, key: newKey };
      store.write(moved);
      forgetRekey();
      return moved;
    }
    const outcome = (await notYours(response)) ? "moved" : response.status === 404 ? "gone" : response.status === 410 ? "left" : null;
    if (leaveEpoch !== epoch) return leftMeanwhile();
    if (!outcome) return false;
    store.write(null);
    forgetRekey();
    return outcome;
  } catch {
    return leaveEpoch !== epoch ? leftMeanwhile() : false;
  }
}

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
// this entry, or "moved" when another phone took it over, so the caller can
// say so.
export function syncLeaderboard(zone: Zone, charges: Charge[]): Promise<boolean | "gone" | "moved"> {
  return tracked(sync(zone, charges));
}

async function sync(zone: Zone, charges: Charge[]): Promise<boolean | "gone" | "moved"> {
  const epoch = leaveEpoch;
  let membership = store.getSnapshot();
  if (!membership) return true;
  const newKey = storedRekey();
  if (newKey && newKey !== membership.key) {
    const result = await rekey(membership, newKey, epoch);
    if (result === false || result === "gone" || result === "moved") return result;
    if (result === "left") return true;
    membership = result;
  } else if (newKey) forgetRekey();
  const fingerprint = syncFingerprint(membership, zone, charges);
  try {
    const last = JSON.parse(window.localStorage.getItem(SYNCED_KEY) ?? "null") as { fingerprint?: string; at?: number } | null;
    if (last?.fingerprint === fingerprint && Date.now() - (last.at ?? 0) < RESYNC_AFTER_MS) return true;
  } catch { /* unreadable: just send */ }
  try {
    const response = await submit(membership, zone, charges);
    // Left while this was on its way: nothing to write back (it may be a new
    // membership by now). The leave removes this entry after this settles,
    // and the server won't let a sync put back an entry that left.
    if (leaveEpoch !== epoch) { await leaveAlso([{ id: membership.id, key: membership.key }]); return true; }
    // 410: this entry already left (e.g. from another tab), so forget it here too.
    if (response.status === 410) { store.write(null); return true; }
    // 403: the key no longer matches, so another phone restored a backup and
    // took the entry over. It's theirs now; forget it here.
    if (await notYours(response)) { store.write(null); return "moved"; }
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

// Matched on id and key: one entry can be queued under its old and its new
// key (a key swap in progress), and only one of them still works.
const sameEntry = (a: PendingLeave, b: PendingLeave) => a.id === b.id && a.key === b.key;

function queueLeaves(entries: PendingLeave[]) {
  const queued = pendingLeaves.getSnapshot();
  pendingLeaves.write([...queued, ...entries.filter((entry) => !queued.some((other) => sameEntry(other, entry)))]);
}

// Tries each removal now and drops the ones that went through from the queue;
// whether all went through.
async function sendLeaves(entries: PendingLeave[]) {
  const outcomes = await Promise.all(entries.map(sendLeave));
  const done = entries.filter((_, index) => outcomes[index]);
  pendingLeaves.write(pendingLeaves.getSnapshot().filter((pending) => !done.some((entry) => sameEntry(entry, pending))));
  return outcomes.every(Boolean);
}

// Queues each entry's removal, then tries it now; whether all went through.
async function leaveEntries(entries: PendingLeave[]) {
  queueLeaves(entries);
  return sendLeaves(entries);
}

// For a join or sync that was on its way when the device left: removes these
// too, unless they're still queued (the leave sends those once this settles).
async function leaveAlso(entries: PendingLeave[]) {
  const queued = pendingLeaves.getSnapshot();
  const fresh = entries.filter((entry) => !queued.some((other) => sameEntry(other, entry)));
  if (fresh.length) await leaveEntries(fresh);
}

// Forgets the entry on this device at once, so the UI updates; the removal is
// retried (see retryPendingLeave) until the server confirms it. Resolves to
// whether it went through now.
// A join the server saved but whose answer never arrived exists only as the
// pending join's id and key, so that one is removed too ("Delete my data"
// must not leave it public). So is the entry under a key swap still pending:
// a swap whose answer was lost may have gone through.
export async function leaveLeaderboard() {
  leaveEpoch += 1;
  const membership = store.getSnapshot();
  const newKey = storedRekey();
  const entries = [membership, membership && newKey ? { id: membership.id, key: newKey } : null, storedPendingJoin()]
    .filter((entry) => entry !== null)
    .map(({ id, key }) => ({ id, key }))
    .filter((entry, index, list) => list.findIndex((other) => sameEntry(other, entry)) === index);
  if (!entries.length) return true;
  store.write(null);
  forgetPendingJoin();
  forgetRekey();
  // Queued before waiting, so a page closed meanwhile still finishes it on
  // its next visit. Sent once any join or sync on its way has settled, so
  // none of them can put the entry back (or move it to its new key) after.
  queueLeaves(entries);
  await Promise.allSettled([...inFlight]);
  return sendLeaves(entries);
}

export async function retryPendingLeave() {
  const pending = pendingLeaves.getSnapshot();
  if (!pending.length) return;
  await sendLeaves(pending);
}
