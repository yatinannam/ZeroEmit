"use client";

import { useEffect } from "react";
import { istDayKey } from "../lib/grid";
import { achievements, closestBadge, currentStreakDays, weekSummary } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { useLeaderboardMembership } from "./use-leaderboard";
import { useNotificationPermission, useNotificationPrefs } from "./notifications";
import { isPushActive, removePushSubscription, syncPushSubscription } from "./push-client";

// Keeps the server's copy of what scheduled notifications need — place,
// which ones are on, streak and last charge day, the public leaderboard id,
// the nearly-unlocked badge and this week's totals — in step with this
// device, and drops the subscription when none are wanted. Mounted once in
// the layout.
export function PushSync() {
  const [place] = useStoredLocation();
  const { charges } = useCharges();
  const { prefs } = useNotificationPrefs();
  const permission = useNotificationPermission();
  const membership = useLeaderboardMembership();
  const streak = currentStreakDays(charges);
  const lastChargeDay = charges[0] ? istDayKey(charges[0].loggedAt) : null;
  const wanted = permission === "granted" && Boolean(place) && (prefs.bestTime || prefs.dailyDigest || prefs.streakReminders || prefs.leaderboard || prefs.progress);

  const state = place?.state;
  const name = place?.name;
  const { bestTime, dailyDigest, streakReminders, leaderboard, progress, charges: chargesPref, rewards } = prefs;
  const leaderboardId = membership?.id ?? null;
  const badge = closestBadge(achievements(charges, streak));
  const badgeKey = badge?.key ?? null;
  const badgeHint = badge?.hint ?? null;
  const week = weekSummary(charges);
  const { weekStart, charges: weekCharges, co2Kg: weekCo2Kg, greenPercent: weekGreenPercent } = week;

  useEffect(() => {
    // Debounced: a burst of changes (e.g. logging a charge) syncs once.
    const timer = setTimeout(() => {
      if (wanted && state && name) {
        void syncPushSubscription({
          place: { state, name },
          prefs: { bestTime, dailyDigest, streakReminders, leaderboard, progress, charges: chargesPref, rewards },
          streak,
          lastChargeDay,
          leaderboardId,
          badge: badgeKey && badgeHint ? { key: badgeKey, hint: badgeHint } : null,
          week: { weekStart, charges: weekCharges, co2Kg: weekCo2Kg, greenPercent: weekGreenPercent },
        });
      } else if (!wanted && isPushActive()) void removePushSubscription();
    }, 1000);
    return () => clearTimeout(timer);
  }, [wanted, state, name, bestTime, dailyDigest, streakReminders, leaderboard, progress, chargesPref, rewards, streak, lastChargeDay, leaderboardId, badgeKey, badgeHint, weekStart, weekCharges, weekCo2Kg, weekGreenPercent]);

  return null;
}
