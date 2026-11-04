"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GroupInfo, MyGroup } from "../lib/groups";
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
  "not-member": "Join the leaderboard first.",
  "no-group": "No group has that code. Check it and try again.",
  "too-many": "You're already in 5 groups. Leave one to join another.",
  full: "That group is full (50 people).",
  rate: "Too many tries. Try again in a while.",
  name: "Use 2 to 30 letters or numbers, with single spaces.",
};

async function post<T>(body: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const membership = getLeaderboardMembership();
  if (!membership) return { ok: false, error: MESSAGES["not-member"] };
  try {
    const response = await fetch("/api/leaderboard/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, id: membership.id, key: membership.key }) });
    const result = await response.json().catch(() => ({})) as T & { code?: string };
    if (!response.ok) return { ok: false, error: (result.code && MESSAGES[result.code]) || "Something went wrong. Try again." };
    bump();
    return { ok: true, value: result };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

export const createGroup = (name: string) => post<GroupInfo>({ action: "create", name });
export const joinGroup = (code: string) => post<GroupInfo>({ action: "join", code });
export const leaveGroup = (code: string) => post<{ ok: true }>({ action: "leave", code });

type GroupsState = { status: "idle" | "loading" | "error" } | { status: "ready"; groups: MyGroup[] };

// This entry's groups; "idle" when the device hasn't joined the leaderboard.
// Reloads after group changes and after each accepted sync (new points).
export function useMyGroups(): GroupsState & { retry: () => void } {
  const membership = useLeaderboardMembership();
  const groupsVersion = useGroupsVersion();
  const boardVersion = useLeaderboardVersion();
  const [attempt, setAttempt] = useState(0);
  const id = membership?.id ?? null;
  const request = `${id}|${groupsVersion}|${boardVersion}|${attempt}`;
  const [result, setResult] = useState<{ request: string; id: string | null; state: GroupsState } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/leaderboard/groups?member=${id}`, { cache: "no-store" })
      .then(async (response): Promise<GroupsState> => response.ok ? { status: "ready", groups: (await response.json() as { groups: MyGroup[] }).groups } : { status: "error" })
      .catch((): GroupsState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, id, state }); });
    return () => { cancelled = true; };
  }, [id, request]);

  const retry = () => setAttempt((n) => n + 1);
  if (!id) return { status: "idle", retry };
  if (result?.request === request) return { ...result.state, retry };
  // While the same entry's list reloads, keep showing the last one.
  return result?.id === id && result.state.status === "ready" ? { ...result.state, retry } : { status: "loading", retry };
}
