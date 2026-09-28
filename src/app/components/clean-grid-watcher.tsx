"use client";

import { useEffect } from "react";
import { istDayKey, planByDay, type GridData } from "../lib/grid";
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

    async function check() {
      if (!notificationPrefEnabled("bestTime")) return;
      const key = `${state}:${istDayKey(Date.now())}`;
      try { if (window.localStorage.getItem(ALERTED_KEY) === key) return; } catch { return; }
      const response = await fetch(`/api/grid?state=${encodeURIComponent(state!)}`).catch(() => null);
      if (!response?.ok || cancelled) return;
      const data = await response.json() as GridData;
      const best = planByDay(data).today.windows[0];
      const current = data.current;
      if (!best?.start.isNow || !current || cancelled) return;
      if (!(current.intensityClass ? current.intensityClass === "green" : current.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD)) return;
      try { window.localStorage.setItem(ALERTED_KEY, key); } catch { /* storage unavailable */ }
      const intensity = Math.round(current.carbonIntensity);
      if (document.visibilityState !== "visible" && isPushActive()) return;
      if (document.visibilityState === "visible") showToast(`Good time to charge: ${intensity} gCO₂/kWh right now, the cleanest for the rest of today`);
      else void sendNotification("bestTime", "Good time to charge", `The grid near ${name} is at ${intensity} gCO₂/kWh, the cleanest it will be for the rest of today.`, "/");
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
