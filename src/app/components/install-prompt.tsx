"use client";
import { useSyncExternalStore } from "react";
import { DISMISS_DAYS, installPromptMode, type InstallPromptMode } from "../lib/install";
import { Icon } from "./icon-set";

// Chromium's install event; not in the DOM typings.
type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISSED_KEY = "zeroemit-install-dismissed";
const DAY_MS = 86_400_000;

// Module-level so a beforeinstallprompt fired before (or away from) Home is
// still kept: the browser fires it once per page load, not per mount.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let dismissedUntil: number | null = null;
let isIos = false;
let listening = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }

function readDismissedUntil(): number | null {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY));
    return at > 0 ? at + DISMISS_DAYS * DAY_MS : null;
  } catch { return null; }
}

// Idempotent; called at module load and on first subscribe. Called from
// PwaRegister too so the event is caught whichever page the app opens on.
export function listenForInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // iPadOS reports itself as a Mac; touch points give it away.
  isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  dismissedUntil = readDismissedUntil();
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredPrompt = event as BeforeInstallPromptEvent; notify(); });
  window.addEventListener("appinstalled", () => { installed = true; deferredPrompt = null; notify(); });
}
listenForInstallPrompt();

function subscribe(listener: () => void) {
  listenForInstallPrompt();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
// A string or null, so it's referentially stable between changes for free.
function getSnapshot(): InstallPromptMode { return installPromptMode({ installed, dismissedUntil, now: Date.now(), hasPrompt: deferredPrompt !== null, isIos }); }
// Nothing on the server or during hydration; the card appears after mount.
function getServerSnapshot(): InstallPromptMode { return null; }

async function install() {
  const event = deferredPrompt;
  if (!event) return;
  // prompt() works once per event; clearing first also guards a double tap.
  deferredPrompt = null;
  try { await event.prompt(); await event.userChoice; } catch { /* already used or blocked — nothing to recover */ }
  // Hidden either way: the browser won't offer the event again for a while.
  notify();
}

function dismiss() {
  const now = Date.now();
  try { window.localStorage.setItem(DISMISSED_KEY, String(now)); } catch { /* storage unavailable — hides for this page load only */ }
  dismissedUntil = now + DISMISS_DAYS * DAY_MS;
  notify();
}

export function InstallPrompt() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!mode) return null;
  return <section className="install-card card" aria-labelledby="install-title">
    <span className="install-icon"><Icon name={mode === "ios" ? "share" : "download"}/></span>
    <div className="install-body">
      <h2 id="install-title">Install ZeroEmit</h2>
      <p>{mode === "ios" ? "Tap Share, then Add to Home Screen. On iPhone, notifications only work once ZeroEmit is on your Home Screen." : "Open it like an app and get reliable charging reminders."}</p>
      <div className="install-actions">{mode === "install" && <button className="primary-button" onClick={install}><Icon name="download" size={18}/> Install</button>}<button className="text-button" onClick={dismiss}>Not now</button></div>
    </div>
  </section>;
}
