"use client";
import { useSyncExternalStore } from "react";

// The current time, floored to the minute, that re-renders when the minute
// changes, so "plug in at 2:00 pm" doesn't stay up at 2:10. 0 in the server
// render and during hydration: the prerendered page can't know the time.
function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 15_000);
  document.addEventListener("visibilitychange", onChange);
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onChange); };
}
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function useMinute() {
  return useSyncExternalStore(subscribe, currentMinute, () => 0);
}
