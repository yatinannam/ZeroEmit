"use client";

import { useEffect } from "react";
import { istDayKey } from "../lib/grid";
import { currentStreakDays } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { useNotificationPermission, useNotificationPrefs } from "./notifications";
import { isPushActive, removePushSubscription, syncPushSubscription } from "./push-client";

// Keeps the server's copy of what scheduled notifications need — place,
// which ones are on, streak and last charge day — in step with this device,
// and drops the subscription when none are wanted. Mounted once in the layout.
export function PushSync() {
  const [place] = useStoredLocation();
  const { charges } = useCharges();
  const { prefs } = useNotificationPrefs();
  const permission = useNotificationPermission();
  const streak = currentStreakDays(charges);
  const lastChargeDay = charges[0] ? istDayKey(charges[0].loggedAt) : null;
  const wanted = permission === "granted" && Boolean(place) && (prefs.bestTime || prefs.dailyDigest || prefs.streakReminders);

  const state = place?.state;
  const name = place?.name;
  const { bestTime, dailyDigest, streakReminders, charges: chargesPref, rewards } = prefs;

  useEffect(() => {
    // Debounced: a burst of changes (e.g. logging a charge) syncs once.
    const timer = setTimeout(() => {
      if (wanted && state && name) void syncPushSubscription({ place: { state, name }, prefs: { bestTime, dailyDigest, streakReminders, charges: chargesPref, rewards }, streak, lastChargeDay });
      else if (!wanted && isPushActive()) void removePushSubscription();
    }, 1000);
    return () => clearTimeout(timer);
  }, [wanted, state, name, bestTime, dailyDigest, streakReminders, chargesPref, rewards, streak, lastChargeDay]);

  return null;
}
