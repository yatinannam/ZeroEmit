import { afterAll, describe, expect, test } from "bun:test";
import { createLocalStorageStore } from "./local-storage-store";

// A stand-in window: localStorage that refuses writes while `full`, and the
// "storage" listeners, so another tab's change can be played back.
const storage = new Map<string, string>();
let full = false;
const storageListeners = new Set<(event: { key: string | null }) => void>();
const saved = (globalThis as { window?: unknown }).window;
Object.assign(globalThis, {
  window: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { if (full) throw new DOMException("Quota exceeded", "QuotaExceededError"); storage.set(key, value); } },
    addEventListener: (_type: string, listener: (event: { key: string | null }) => void) => { storageListeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: { key: string | null }) => void) => { storageListeners.delete(listener); },
  },
});
afterAll(() => { if (saved === undefined) delete (globalThis as { window?: unknown }).window; else Object.assign(globalThis, { window: saved }); });

const makeStore = () => createLocalStorageStore<string[]>("zeroemit-test", (raw) => JSON.parse(raw) as string[], (value) => JSON.stringify(value), []);

describe("createLocalStorageStore", () => {
  test("a refused write says so and keeps the value for the visit", () => {
    storage.clear();
    full = true;
    const store = makeStore();
    expect(store.write(["a"])).toBe(false);
    expect(store.getSnapshot()).toEqual(["a"]);
    full = false;
    expect(store.write(["a", "b"])).toBe(true);
    expect(storage.get("zeroemit-test")).toBe(JSON.stringify(["a", "b"]));
  });

  test("another tab's change replaces a value only kept in memory", () => {
    storage.clear();
    full = true;
    const store = makeStore();
    const unsubscribe = store.subscribe(() => undefined);
    store.write(["mine"]);
    full = false;
    storage.set("zeroemit-test", JSON.stringify(["other tab"]));
    storageListeners.forEach((listener) => listener({ key: "zeroemit-test" }));
    expect(store.getSnapshot()).toEqual(["other tab"]);
    unsubscribe();
  });

  test("a change to another key leaves it alone", () => {
    storage.clear();
    full = true;
    const store = makeStore();
    const unsubscribe = store.subscribe(() => undefined);
    store.write(["mine"]);
    storageListeners.forEach((listener) => listener({ key: "zeroemit-other" }));
    expect(store.getSnapshot()).toEqual(["mine"]);
    full = false;
    unsubscribe();
  });
});
