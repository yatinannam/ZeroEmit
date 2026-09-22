"use client";

const REMINDER_KEY = "zeroemit-reminder";

export function notificationsEnabled(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

// A permission grant is silent — nothing visibly changes, so there's no way
// to tell it actually worked. Firing one real notification through the
// service worker (required on Android/Chrome; the bare `Notification`
// constructor throws there once a service worker controls the page) proves
// it end to end instead of asking for trust.
async function showConfirmationNotification() {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("ZeroEmit notifications are on", {
        body: "This confirms notifications are working on this device.",
        icon: "/icons/icon-192.png",
        tag: "zeroemit-notifications-enabled",
      });
      return;
    }
  } catch { /* fall through to the direct constructor below */ }
  try { new Notification("ZeroEmit notifications are on"); } catch { /* nothing left to try */ }
}

export async function requestNotificationPermission(): Promise<{ granted: boolean; message: string }> {
  if (!("Notification" in window)) return { granted: false, message: "This browser does not support notifications." };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { granted: false, message: "Notifications are blocked. Enable them in your browser settings to receive alerts once available." };
  window.localStorage.setItem(REMINDER_KEY, "true");
  await showConfirmationNotification();
  return { granted: true, message: "Notifications are on for this device — check for the confirmation." };
}
