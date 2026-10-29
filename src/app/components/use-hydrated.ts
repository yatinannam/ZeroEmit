"use client";
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

// False in the server render and during hydration, true after. Pages are
// prerendered without the user's saved place, so anything that depends on it
// (the place's name, fetches for its data) waits for this.
export function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
