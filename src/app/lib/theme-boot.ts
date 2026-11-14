export const THEME_KEY = "zeroemit-theme";
// Mirrors use-location.ts's key: no saved place means first launch.
const LOCATION_KEY = "zeroemit-location";
// Browser top-bar colour for each theme — matches --surface in globals.css.
export const BAR_COLOR = { light: "#f1fdec", dark: "#0f1510" };

// Runs in <head> before first paint (see layout.tsx), so a pinned theme never
// flashes the other one first. On first launch it also marks <html> with
// data-first-run, which hides the prerendered page until the welcome intro
// (LocationGate) is up, so a new user doesn't see the dashboard flash first. "system" leaves data-theme unset and lets the
// prefers-color-scheme rules in globals.css decide. Kept out of the
// "use client" theme module: a server component importing a constant from a
// client module gets a client reference, not the string. A pinned theme also
// sets every theme-color meta (rendered above this script), so the phone's
// status bar matches from the first paint, not only once ThemeSync runs.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].content=${JSON.stringify(BAR_COLOR)}[t]}var l=localStorage.getItem("${LOCATION_KEY}");if(!l||l==="null")document.documentElement.setAttribute("data-first-run","")}catch(e){}})()`;
