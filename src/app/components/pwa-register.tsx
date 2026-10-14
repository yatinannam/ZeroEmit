"use client";
import { useEffect } from "react";
import { listenForInstallPrompt } from "./install-prompt";

// Only in production: under `next dev` the worker would cache dev bundles and
// serve stale code between edits. Clear out any registration left from before.
export function PwaRegister() {
  useEffect(() => {
    // Mounted on every page, so the install event is kept even when the app opens away from Home.
    listenForInstallPrompt();
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") { navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister())).catch(() => undefined); return; }
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
