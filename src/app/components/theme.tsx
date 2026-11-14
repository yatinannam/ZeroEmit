"use client";
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { BAR_COLOR, THEME_KEY } from "../lib/theme-boot";

export type ThemeChoice = "system" | "light" | "dark";

const store = createLocalStorageStore<ThemeChoice>(THEME_KEY, (raw) => (raw === "light" || raw === "dark" ? raw : "system"), (value) => value, "system");

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", choice);
  // viewport.themeColor renders one meta per scheme (media="(prefers-color-scheme: …)");
  // a pinned theme overrides both, "system" restores each to its own scheme.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = choice !== "system" ? choice : meta.media.includes("dark") ? "dark" : "light";
    meta.content = BAR_COLOR[scheme];
  });
}

export function useThemeChoice() {
  const choice = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [choice, store.write] as const;
}

// Mounted once in the layout. Also re-applies the attribute after React's
// development-mode remount clears attributes the inline script set on <html>.
// Reads the stored choice itself rather than `choice`: during hydration
// `choice` is the server's "system", and applying that would briefly undo a
// pinned theme the boot script already set.
export function ThemeSync() {
  const [choice] = useThemeChoice();
  useLayoutEffect(() => applyTheme(store.getSnapshot()), [choice]);
  // Next remounts the head on navigation, which puts the layout's theme-color
  // metas back with their per-scheme colours: re-apply when new ones arrive,
  // or a pinned theme gets the other theme's status bar after a tab switch.
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof HTMLMetaElement && node.name === "theme-color"))) applyTheme(store.getSnapshot());
    });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
