export const THEME_KEY = "zeroemit-theme";
// Mirrors use-location.ts's key: no saved place means first launch.
const LOCATION_KEY = "zeroemit-location";

// Runs in <head> before first paint (see layout.tsx), so a pinned theme never
// flashes the other one first. On first launch it also marks <html> with
// data-first-run, which hides the prerendered page until the welcome intro
// (LocationGate) is up, so a new user doesn't see the dashboard flash first. "system" leaves data-theme unset and lets the
// prefers-color-scheme rules in globals.css decide. Kept out of the
// "use client" theme module: a server component importing a constant from a
// client module gets a client reference, not the string.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);var l=localStorage.getItem("${LOCATION_KEY}");if(!l||l==="null")document.documentElement.setAttribute("data-first-run","")}catch(e){}})()`;
