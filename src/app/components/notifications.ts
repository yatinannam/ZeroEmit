"use client";
import { useSyncExternalStore } from "react";

const REMINDER_KEY = "zeroemit-reminder";
const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Also pick up a permission change made in browser settings while open.
  let status: PermissionStatus | null = null;
  navigator.permissions?.query({ name: "notifications" }).then((result) => { status = result; result.addEventListener("change", listener); }).catch(() => undefined);
  return () => { listeners.delete(listener); status?.removeEventListener("change", listener); };
}

function getSnapshot() {
  return "Notification" in window && Notification.permission === "granted";
}

// Read through useSyncExternalStore with a `false` server snapshot: reading
// Notification.permission in a useState initializer rendered `false` on the
// server but `true` on the client once granted — a hydration mismatch.
export function useNotificationsEnabled() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function clearNotificationFlag() {
  try { window.localStorage.removeItem(REMINDER_KEY); } catch { /* storage unavailable */ }
}

// A permission grant is silent — nothing visibly changes, so there's no way
// to tell it actually worked. Firing one real notification through the
// service worker (required on Android/Chrome; the bare `Notification`
// constructor throws there once a service worker controls the page) proves
// it end to end instead of asking for trust. `ready` never settles if the
// worker failed to register, so give up on it after a few seconds.
async function showConfirmationNotification() {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
      if (registration) {
        await registration.showNotification("ZeroEmit notifications are on", { body: "This confirms notifications are working on this device.", icon: "/icons/icon-192.png", tag: "zeroemit-notifications-enabled" });
        return;
      }
    }
  } catch { /* fall through to the direct constructor below */ }
  try { new Notification("ZeroEmit notifications are on"); } catch { /* nothing left to try */ }
}

function isIosBrowserTab() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches;
}

export async function requestNotificationPermission(): Promise<{ granted: boolean; message: string }> {
  // iOS only exposes notifications to web apps added to the Home Screen.
  if (!("Notification" in window)) return { granted: false, message: isIosBrowserTab() ? "On iPhone, add ZeroEmit to your Home Screen (Share → Add to Home Screen) and open it from there to turn on notifications." : "This browser does not support notifications." };
  if (Notification.permission === "granted") return { granted: true, message: "Notifications are already on for this device." };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { granted: false, message: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." };
  try { window.localStorage.setItem(REMINDER_KEY, "true"); } catch { /* storage unavailable */ }
  await showConfirmationNotification();
  notify();
  return { granted: true, message: "Notifications are on — you should see a confirmation now." };
}
