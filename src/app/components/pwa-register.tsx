"use client";
import { useEffect } from "react";

// Only in production: under `next dev` the worker would cache dev bundles and
// serve stale code between edits. Clear out any registration left from before.
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") { navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister())).catch(() => undefined); return; }
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
