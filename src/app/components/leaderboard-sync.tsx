"use client";

import { useEffect } from "react";
import { zoneOf } from "../lib/places";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { syncLeaderboard, useLeaderboardMembership } from "./use-leaderboard";

// While this device is on the leaderboard, re-sends this month's charges when
// they change (or the user's grid region does) so the server can rescore.
// Mounted once in the layout.
export function LeaderboardSync() {
  const joined = useLeaderboardMembership() !== null;
  const [place] = useStoredLocation();
  const { charges } = useCharges();
  const zone = place ? zoneOf(place) : null;

  useEffect(() => {
    if (!joined || !zone) return;
    // Debounced: a burst of changes (e.g. logging a charge) syncs once.
    const timer = setTimeout(() => void syncLeaderboard(zone, charges), 1000);
    return () => clearTimeout(timer);
  }, [joined, zone, charges]);

  return null;
}
