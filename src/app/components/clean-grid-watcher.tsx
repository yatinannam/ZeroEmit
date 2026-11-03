"use client";

import { useEffect } from "react";
import { istDayKey, liveReading, planByDay, type GridData } from "../lib/grid";
import { GREEN_CHARGE_FALLBACK_THRESHOLD } from "../lib/rewards";
import { useStoredLocation } from "./use-location";
import { notificationPrefEnabled, sendNotification } from "./notifications";
import { isPushActive } from "./push-client";
import { showToast } from "./toast";

const ALERTED_KEY = "zeroemit-clean-alert";
const CHECK_EVERY_MS = 15 * 60_000;

// While ZeroEmit is open (in front or in the background), alert once a day
// per state when right now is the cleanest time left to charge today *and*
// the grid is actually green — late in the day "the cleanest time left" can
// still be dirty, which isn't worth an interruption.
// Visible: a toast. Backgrounded: a system notification — unless the server
// already sends scheduled "best time" pushes to this device (push-client),
// which would make this a duplicate.
export function CleanGridWatcher() {
  const [place] = useStoredLocation();
  const state = place?.state;
  const name = place?.name;

  useEffect(() => {
    if (!state || !name) return;
    let cancelled = false;
    // The interval and a return to the tab can fire together; one check at a
    // time, so the same alert can't go out twice.
    let checking = false;

    async function check() {
      if (checking) return;
      checking = true;
      try { await checkOnce(); } catch { /* a bad response just skips this check */ } finally { checking = false; }
    }

    async function checkOnce() {
      if (!notificationPrefEnabled("bestTime")) return;
      const key = `${state}:${istDayKey(Date.now())}`;
      try { if (window.localStorage.getItem(ALERTED_KEY) === key) return; } catch { return; }
      const response = await fetch(`/api/grid?state=${encodeURIComponent(state!)}`).catch(() => null);
      if (!response?.ok || cancelled) return;
      const data = await response.json() as GridData;
      const best = planByDay(data).today.windows[0];
      const current = liveReading(data);
      if (!best?.start.isNow || !current || cancelled) return;
      if (!(current.intensityClass ? current.intensityClass === "green" : current.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD)) return;
      const intensity = Math.round(current.carbonIntensity);
      // Today only counts as alerted once something was actually shown: in
      // the background with nothing to show it through (server pushes cover
      // it, or notifications aren't allowed), a later check can still toast
      // when the user comes back.
      if (document.visibilityState === "visible") showToast(`Good time to charge: ${intensity} gCO₂/kWh right now, the cleanest for the rest of today`);
      else {
        if (isPushActive() || !("Notification" in window) || Notification.permission !== "granted") return;
        await sendNotification("bestTime", "Good time to charge", `The grid near ${name} is at ${intensity} gCO₂/kWh, the cleanest it will be for the rest of today.`, "/");
      }
      try { window.localStorage.setItem(ALERTED_KEY, key); } catch { /* storage unavailable */ }
    }

    // A short delay so the first check doesn't talk over whatever the user just did.
    const first = setTimeout(check, 8000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [state, name]);

  return null;
}
