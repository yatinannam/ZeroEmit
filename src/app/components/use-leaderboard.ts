"use client";

import { useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import type { Charge } from "./use-charges";
import { istMonthKey, toLeaderboardCharges } from "../lib/leaderboard";
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
function pendingJoin(): { id: string; key: string } {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PENDING_JOIN_KEY) ?? "null") as { id?: unknown; key?: unknown } | null;
    if (stored && typeof stored.id === "string" && typeof stored.key === "string") return { id: stored.id, key: stored.key };
  } catch { /* fall through to a new one */ }
  const fresh = { id: crypto.randomUUID(), key: crypto.randomUUID() };
  try { window.localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify(fresh)); } catch { /* storage unavailable */ }
  return fresh;
}

export async function joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<{ ok: true; rank: number } | { ok: false; error: string }> {
  const current = store.getSnapshot();
  const { id, key } = current ?? pendingJoin();
  const membership: Membership = { id, key, name };
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) {
      const { code } = await response.json().catch(() => ({})) as { code?: string };
      const error = code === "name" ? "That name can't be used. Try another one."
        : code === "name-taken" ? `That name is already on this month's leaderboard. Try adding an initial, like "${name.split(" ")[0]} ${name.split(" ")[1]?.[0] ?? "R"}".`
        : response.status === 429 ? "Too many updates. Try again in a while." : "Couldn't join the leaderboard. Try again.";
      return { ok: false, error };
    }
    const body = await response.json() as { rank: number };
    store.write(membership);
    // The join already sent this score; don't send it again straight away.
    rememberSynced(syncFingerprint(membership, zone, charges));
    try { window.localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* storage unavailable */ }
    return { ok: true, rank: body.rank };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
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

export async function syncLeaderboard(zone: Zone, charges: Charge[]) {
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

// Forgets the entry on this device at once, so the UI updates; the removal is
// retried (see retryPendingLeave) until the server confirms it. Resolves to
// whether it went through now.
export async function leaveLeaderboard() {
  const membership = store.getSnapshot();
  if (!membership) return true;
  const entry = { id: membership.id, key: membership.key };
  store.write(null);
  pendingLeaves.write([...pendingLeaves.getSnapshot(), entry]);
  const done = await sendLeave(entry);
  if (done) pendingLeaves.write(pendingLeaves.getSnapshot().filter((pending) => pending.id !== entry.id));
  return done;
}

export async function retryPendingLeave() {
  const pending = pendingLeaves.getSnapshot();
  if (!pending.length) return;
  const outcomes = await Promise.all(pending.map(sendLeave));
  const done = new Set(pending.filter((_, index) => outcomes[index]).map((entry) => entry.id));
  pendingLeaves.write(pendingLeaves.getSnapshot().filter((entry) => !done.has(entry.id)));
}
