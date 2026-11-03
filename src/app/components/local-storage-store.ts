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

  // Set when storage refused a write (blocked, private mode, full): the value
  // then lives in memory for this visit, so choices like the first-run place
  // still take effect instead of the screen ignoring the tap.
  let memoryRaw: string | null | undefined;

  function readRaw(): string | null {
    if (memoryRaw !== undefined) return memoryRaw;
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
    const raw = serialize(value);
    try { window.localStorage.setItem(key, raw); memoryRaw = undefined; } catch { memoryRaw = raw; /* storage unavailable/quota exceeded — kept in memory, won't persist */ }
    notify();
  }

  return { subscribe, getSnapshot, getServerSnapshot, write };
}
