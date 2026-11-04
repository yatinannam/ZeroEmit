"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GroupInfo, MyGroup } from "../lib/groups";
import { useHydrated } from "./use-hydrated";
import { getLeaderboardMembership, useLeaderboardMembership, useLeaderboardVersion } from "./use-leaderboard";

// Group challenges on the device: the calls behind Create, Join and Leave,
// and the list of this entry's groups. Groups hang off the leaderboard
// entry, so every call carries its id and key.

// Bumped after a create, join or leave, so open lists and boards reload.
let version = 0;
const listeners = new Set<() => void>();
function bump() { version += 1; listeners.forEach((listener) => listener()); }
export function useGroupsVersion() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => 0);
}

const MESSAGES: Record<string, string> = {
  "not-member": "Your leaderboard entry has expired. Join the leaderboard again from Rewards.",
  forbidden: "This device's leaderboard entry doesn't match the server's. Leave the leaderboard and join again.",
  "no-group": "No group has that code. Check it and try again.",
  "too-many": "You're already in 5 groups. Leave one to join another.",
  full: "That group is full (50 people).",
  rate: "Too many tries. Try again in a while.",
  name: "Use 2 to 30 letters or numbers, with single spaces.",
};

// `code` is the server's reason (see the groups route), for callers that can fix it.
export type GroupCall<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

async function post<T>(body: Record<string, unknown>, quiet = false): Promise<GroupCall<T>> {
  const membership = getLeaderboardMembership();
  if (!membership) return { ok: false, error: "Join the leaderboard first.", code: "not-member" };
  try {
    const response = await fetch("/api/leaderboard/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, id: membership.id, key: membership.key }) });
    const result = await response.json().catch(() => ({})) as T & { code?: string };
    if (!response.ok) return { ok: false, error: (result.code && MESSAGES[result.code]) || (response.status === 503 ? "Groups aren't available right now." : "Something went wrong. Try again."), code: result.code };
    if (!quiet) bump();
    return { ok: true, value: result };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

export const createGroup = (name: string) => post<GroupInfo>({ action: "create", name });
export const joinGroup = (code: string) => post<GroupInfo>({ action: "join", code });
export const leaveGroup = (code: string) => post<{ ok: true }>({ action: "leave", code });

type GroupsState = { status: "idle" | "loading" | "error" } | { status: "ready"; groups: MyGroup[] };
const listGroups = () => post<{ groups: MyGroup[] }>({ action: "list" }, true);

// This entry's groups; "idle" when the device hasn't joined the leaderboard.
// Reloads after group changes and after each accepted sync (new points).
export function useMyGroups(): GroupsState & { retry: () => void } {
  const membership = useLeaderboardMembership();
  const hydrated = useHydrated();
  const groupsVersion = useGroupsVersion();
  const boardVersion = useLeaderboardVersion();
  const [attempt, setAttempt] = useState(0);
  const id = membership?.id ?? null;
  const request = `${id}|${groupsVersion}|${boardVersion}|${attempt}`;
  const [result, setResult] = useState<{ request: string; id: string | null; state: GroupsState } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // The list needs the entry's key too, so it's a POST like the changes.
    listGroups().then((result): GroupsState => result.ok ? { status: "ready", groups: result.value.groups } : { status: "error" })
      .then((state) => { if (!cancelled) setResult({ request, id, state }); });
    return () => { cancelled = true; };
  }, [id, request]);

  const retry = () => setAttempt((n) => n + 1);
  // Before hydration the saved entry isn't read yet: "loading", not "no entry".
  if (!hydrated) return { status: "loading", retry };
  if (!id) return { status: "idle", retry };
  if (result?.request === request) return { ...result.state, retry };
  // While the same entry's list reloads, keep showing the last one.
  return result?.id === id && result.state.status === "ready" ? { ...result.state, retry } : { status: "loading", retry };
}
