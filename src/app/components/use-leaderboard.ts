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

export async function syncLeaderboard(zone: Zone, charges: Charge[]) {
  const membership = store.getSnapshot();
  if (!membership) return;
  try { await submit(membership, zone, charges); } catch { /* offline: the next change syncs again */ }
}

// Forgets the entry on this device first, so the UI updates at once; if the
// request fails, the entry drops off at the monthly reset.
export async function leaveLeaderboard() {
  const membership = store.getSnapshot();
  if (!membership) return;
  store.write(null);
  try {
    await fetch("/api/leaderboard/member", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: membership.id, key: membership.key }) });
  } catch { /* see above */ }
}
