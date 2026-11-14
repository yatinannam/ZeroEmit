"use client";

import { useEffect, useRef, useState } from "react";
import { istDayKey } from "../lib/grid";
import { achievements, closestBadge, currentStreakDays, weekSummary } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { useLeaderboardMembership } from "./use-leaderboard";
import { useNotificationPermission, useNotificationPrefs } from "./notifications";
import { removePushSubscription, syncPushSubscription } from "./push-client";

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

  // Bumped to sync again: after a sync that failed (offline, server busy),
  // once back online or on screen; and whenever the service worker says the
  // push service replaced the subscription (pushsubscriptionchange in sw.js).
  const [attempt, setAttempt] = useState(0);
  const failed = useRef(false);
  useEffect(() => {
    const retry = () => { if (failed.current && navigator.onLine && document.visibilityState === "visible") setAttempt((value) => value + 1); };
    const onMessage = (event: MessageEvent) => { if ((event.data as { type?: unknown } | null)?.type === "push-subscription-changed") setAttempt((value) => value + 1); };
    const worker = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    worker?.addEventListener("message", onMessage);
    return () => { window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); worker?.removeEventListener("message", onMessage); };
  }, []);

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
        }).then((synced) => { failed.current = !synced; });
      // Not gated on isPushActive(): a sync that failed (offline) clears
      // that flag while the server may still hold this device, and opting
      // out must still reach it. With no subscription this is a no-op.
      } else if (!wanted) { failed.current = false; void removePushSubscription(); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [wanted, state, name, bestTime, dailyDigest, streakReminders, leaderboard, progress, chargesPref, rewards, streak, lastChargeDay, leaderboardId, badgeKey, badgeHint, weekStart, weekCharges, weekCo2Kg, weekGreenPercent, attempt]);

  return null;
}
