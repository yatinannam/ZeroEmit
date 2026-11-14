"use client";

import { serverPushAvailable, type Prefs } from "./notifications";
import type { Place } from "../lib/places";

const ACTIVE_KEY = "zeroemit-push-active";

// Whether the server currently holds a working subscription for this device —
// the in-app clean-grid watcher stays quiet about system notifications then,
// so the same alert doesn't arrive twice.
export function isPushActive() {
  try { return window.localStorage.getItem(ACTIVE_KEY) === "1"; } catch { return false; }
}

function setPushActive(active: boolean) {
  try { if (active) window.localStorage.setItem(ACTIVE_KEY, "1"); else window.localStorage.removeItem(ACTIVE_KEY); } catch { /* storage unavailable */ }
}

export function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// Whether a subscription was made with this server key. A browser that
// doesn't report the key (null) is taken at its word rather than
// resubscribed on every sync.
export function sameServerKey(subscriptionKey: ArrayBuffer | null, key: Uint8Array) {
  if (!subscriptionKey) return true;
  const bytes = new Uint8Array(subscriptionKey);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

// Push needs the service worker, which only runs in production builds.
async function activeRegistration() {
  if (!serverPushAvailable || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.active ? registration : null;
}

// `leaderboardId` is the public leaderboard id (never the key); `badge` and
// `week` feed the badge nudge and weekly recap.
export type PushDetails = { place: Place; prefs: Prefs; streak: number; lastChargeDay: string | null; leaderboardId: string | null; badge: { key: string; hint: string } | null; week: { weekStart: string; charges: number; co2Kg: number; greenPercent: number } };

// Resolves to whether the server now holds this device's subscription; false
// (offline, server busy, worker not active yet) means try again later.
export async function syncPushSubscription({ place, prefs, streak, lastChargeDay, leaderboardId, badge, week }: PushDetails) {
  const registration = await activeRegistration();
  if (!registration || Notification.permission !== "granted") return false;
  try {
    const key = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!);
    let subscription = await registration.pushManager.getSubscription();
    // Made with an earlier server key (since rotated): the push service
    // rejects every send to it, so drop it, on the server too, and subscribe again.
    if (subscription && !sameServerKey(subscription.options.applicationServerKey, key)) {
      await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const response = await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), state: place.state, name: place.name, prefs: { bestTime: prefs.bestTime, dailyDigest: prefs.dailyDigest, streakReminders: prefs.streakReminders, leaderboard: prefs.leaderboard, progress: prefs.progress }, streak, lastChargeDay, leaderboardId, badge, week }),
    });
    setPushActive(response.ok);
    return response.ok;
  } catch {
    setPushActive(false);
    return false;
  }
}

// Asks the server to push a test notification to this device. Returns an
// error message, or null on success.
export async function sendServerTestPush(): Promise<string | null> {
  const registration = await activeRegistration();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return "This device isn't registered for scheduled notifications yet.";
  const response = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => null);
  if (response?.ok) return null;
  const body = await response?.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "Couldn't reach the server.";
}

export async function removePushSubscription() {
  setPushActive(false);
  const registration = await activeRegistration();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
