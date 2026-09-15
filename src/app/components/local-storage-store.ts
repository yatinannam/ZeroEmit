"use client";

// A small useSyncExternalStore-compatible store backed by one localStorage
// key, shared by use-charges.ts, use-profile.ts, and use-location.ts.
//
// localStorage access can throw synchronously in some real environments
// (Safari private browsing, storage-blocked iframes/embeds) — an unguarded
// getItem/setItem inside getSnapshot() would crash the whole render instead
// of degrading to `fallback`, so every access here is wrapped.
export function createLocalStorageStore<T>(key: string, parse: (raw: string) => T, serialize: (value: T) => string, fallback: T) {
  const listeners = new Set<() => void>();
  function notify() { listeners.forEach((listener) => listener()); }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
  }

  function readRaw(): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }

  // useSyncExternalStore requires getSnapshot to return a referentially
  // stable value when nothing changed. Cache against the raw string and
  // only re-parse when it actually changes.
  let cachedRaw: string | null = null;
  let cachedValue: T = fallback;
  let hasCached = false;
  function getSnapshot(): T {
    const raw = readRaw();
    if (hasCached && raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    hasCached = true;
    if (raw === null) { cachedValue = fallback; return cachedValue; }
    try { cachedValue = parse(raw); } catch { cachedValue = fallback; }
    return cachedValue;
  }
  function getServerSnapshot(): T { return fallback; }

  function write(value: T) {
    try { window.localStorage.setItem(key, serialize(value)); } catch { /* storage unavailable/quota exceeded — update won't persist */ }
    notify();
  }

  return { subscribe, getSnapshot, getServerSnapshot, write };
}
