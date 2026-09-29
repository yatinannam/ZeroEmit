"use client";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { THEME_KEY } from "../lib/theme-boot";

export type ThemeChoice = "system" | "light" | "dark";

// Browser top-bar colour for each theme — matches --surface in globals.css.
const BAR_COLOR = { light: "#f1fdec", dark: "#0f1510" };

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
export function ThemeSync() {
  const [choice] = useThemeChoice();
  useLayoutEffect(() => applyTheme(choice), [choice]);
  return null;
}
