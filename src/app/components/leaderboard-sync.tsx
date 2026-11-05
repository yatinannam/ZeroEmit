"use client";

import { useEffect } from "react";
import { zoneOf } from "../lib/places";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { showToast } from "./toast";
import { ENTRY_GONE_MESSAGE, ENTRY_MOVED_MESSAGE, retryPendingLeave, syncLeaderboard, useLeaderboardMembership } from "./use-leaderboard";

// While this device is on the leaderboard, re-sends this month's charges when
// they change (or the user's grid region does) so the server can rescore.
// Also finishes a leave that couldn't reach the server last time. Mounted
// once in the layout.
export function LeaderboardSync() {
  const joined = useLeaderboardMembership() !== null;
  const [place] = useStoredLocation();
  const { charges } = useCharges();
  const zone = place ? zoneOf(place) : null;

  useEffect(() => { void retryPendingLeave(); }, []);

  useEffect(() => {
    if (!joined || !zone) return;
    // Debounced: a burst of changes (e.g. logging a charge) syncs once. A
    // failed sync retries after 1, 2 and 3 minutes, or as soon as the device
    // comes back online.
    const currentZone = zone;
    let attempts = 0;
    let synced = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (synced || cancelled) return;
      clearTimeout(timer);
      const result = await syncLeaderboard(currentZone, charges);
      synced = result !== false;
      // The entry vanished from the server (expired, its name taken): say so
      // once, rather than showing a membership that isn't on the board.
      if (result === "gone") showToast(ENTRY_GONE_MESSAGE);
      if (result === "moved") showToast(ENTRY_MOVED_MESSAGE);
      if (cancelled || synced || attempts >= 3) return;
      attempts += 1;
      timer = setTimeout(run, attempts * 60_000);
    };
    timer = setTimeout(run, 1000);
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener("online", onOnline); };
  }, [joined, zone, charges]);

  return null;
}
