"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";

const REMINDER_KEY = "zeroemit-reminder";

// ---- Permission -----------------------------------------------------------

export type Permission = "granted" | "denied" | "default" | "unsupported";
const listeners = new Set<() => void>();
function notifyPermissionChange() { listeners.forEach((listener) => listener()); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Also pick up a permission change made in browser settings while open.
  let status: PermissionStatus | null = null;
  navigator.permissions?.query({ name: "notifications" }).then((result) => { status = result; result.addEventListener("change", listener); }).catch(() => undefined);
  return () => { listeners.delete(listener); status?.removeEventListener("change", listener); };
}

function permissionNow(): Permission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

// Read through useSyncExternalStore with a "default" server snapshot: reading
// Notification.permission during render would differ between the server and
// a client that has already granted it — a hydration mismatch.
export function useNotificationPermission() {
  return useSyncExternalStore(subscribe, permissionNow, () => "default" as Permission);
}

export function useNotificationsEnabled() {
  return useNotificationPermission() === "granted";
}

export function clearNotificationFlag() {
  try { window.localStorage.removeItem(REMINDER_KEY); } catch { /* storage unavailable */ }
}

// ---- Per-type preferences ---------------------------------------------------

export type NotificationKind = "charges" | "rewards" | "cleanGrid";
export const NOTIFICATION_KINDS: { key: NotificationKind; label: string; detail: string }[] = [
  { key: "charges", label: "Charge confirmations", detail: "When you log a charge, with the points you earned" },
  { key: "rewards", label: "Rewards and streaks", detail: "New levels, achievements and streak milestones" },
  { key: "cleanGrid", label: "Clean-grid alerts", detail: "Once a day, when right now is the cleanest time left to charge (while ZeroEmit is open)" },
];
type Prefs = Record<NotificationKind, boolean>;
const DEFAULT_PREFS: Prefs = { charges: true, rewards: true, cleanGrid: true };

const prefsStore = createLocalStorageStore<Prefs>(
  "zeroemit-notification-prefs",
  (raw) => ({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }),
  (value) => JSON.stringify(value),
  DEFAULT_PREFS,
);

export function useNotificationPrefs() {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getServerSnapshot);
  const setPref = useCallback((kind: NotificationKind, on: boolean) => prefsStore.write({ ...prefsStore.getSnapshot(), [kind]: on }), []);
  return { prefs, setPref };
}

export function resetNotificationPrefs() {
  prefsStore.write(DEFAULT_PREFS);
}

export function notificationPrefEnabled(kind: NotificationKind) {
  return prefsStore.getSnapshot()[kind];
}

// ---- Showing notifications -------------------------------------------------

// Android/Chrome require the service-worker path — the bare `Notification`
// constructor throws there. The worker only exists in production builds, and
// `ready` never settles when there isn't one, so only wait for it (briefly)
// when a registration exists; otherwise go straight to the constructor.
async function display(title: string, options: NotificationOptions & { data?: { url: string } }) {
  const full = { icon: "/icons/icon-192.png", ...options };
  try {
    if ("serviceWorker" in navigator && await navigator.serviceWorker.getRegistration()) {
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
      if (registration) { await registration.showNotification(title, full); return; }
    }
  } catch { /* fall through to the direct constructor below */ }
  try { new Notification(title, full); } catch { /* nothing left to try */ }
}

// Sends only if permission is granted and the user hasn't switched this kind
// off. `url` is where tapping the notification takes them (see sw.js).
export async function sendNotification(kind: NotificationKind, title: string, body: string, url = "/") {
  if (permissionNow() !== "granted" || !notificationPrefEnabled(kind)) return;
  await display(title, { body, tag: `zeroemit-${kind}`, data: { url } });
}

export async function sendTestNotification() {
  await display("ZeroEmit test notification", { body: "Notifications are working on this device.", tag: "zeroemit-test", data: { url: "/profile" } });
}

function isIosBrowserTab() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches;
}

export async function requestNotificationPermission(): Promise<{ granted: boolean; message: string }> {
  // iOS only exposes notifications to web apps added to the Home Screen.
  if (!("Notification" in window)) return { granted: false, message: isIosBrowserTab() ? "On iPhone, add ZeroEmit to your Home Screen (Share, then Add to Home Screen) and open it from there to turn on notifications." : "This browser does not support notifications." };
  if (Notification.permission === "granted") return { granted: true, message: "Notifications are already on for this device." };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { granted: false, message: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." };
  try { window.localStorage.setItem(REMINDER_KEY, "true"); } catch { /* storage unavailable */ }
  // A permission grant is silent, so send one real notification to prove it works end to end.
  await display("ZeroEmit notifications are on", { body: "You'll get charge confirmations, rewards and clean-grid alerts here.", tag: "zeroemit-enabled", data: { url: "/" } });
  notifyPermissionChange();
  return { granted: true, message: "Notifications are on. You should see a confirmation now." };
}
