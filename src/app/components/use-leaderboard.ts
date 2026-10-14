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

export async function joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<{ ok: true; rank: number } | { ok: false; error: string }> {
  const current = store.getSnapshot();
  const membership: Membership = { id: current?.id ?? crypto.randomUUID(), key: current?.key ?? crypto.randomUUID(), name };
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) {
      const error = response.status === 400 ? "That name can't be used. Try another one." : response.status === 429 ? "Too many updates. Try again in a while." : "Couldn't join the leaderboard. Try again.";
      return { ok: false, error };
    }
    const body = await response.json() as { rank: number };
    store.write(membership);
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

export async function syncLeaderboard(zone: Zone, charges: Charge[]) {
  const membership = store.getSnapshot();
  if (!membership) return;
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) return;
    version += 1;
    versionListeners.forEach((listener) => listener());
  } catch { /* offline: the next change syncs again */ }
}

// An entry this device has left but the server hasn't confirmed removing yet.
// It holds the only copy of the key, so it's kept until the removal goes
// through — otherwise the name would stay public with no way to take it down.
type PendingLeave = { id: string; key: string };
const pendingLeave = createLocalStorageStore<PendingLeave | null>(
  "zeroemit-leaderboard-pending-leave",
  (raw) => {
    const value = JSON.parse(raw) as Partial<PendingLeave> | null;
    return value && typeof value.id === "string" && typeof value.key === "string" ? { id: value.id, key: value.key } : null;
  },
  (value) => JSON.stringify(value),
  null,
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
  pendingLeave.write(entry);
  const done = await sendLeave(entry);
  if (done) pendingLeave.write(null);
  return done;
}

export async function retryPendingLeave() {
  const entry = pendingLeave.getSnapshot();
  if (entry && await sendLeave(entry)) pendingLeave.write(null);
}
