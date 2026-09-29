export const THEME_KEY = "zeroemit-theme";

// Runs in <head> before first paint (see layout.tsx), so a pinned theme never
// flashes the other one first. "system" leaves data-theme unset and lets the
// prefers-color-scheme rules in globals.css decide. Kept out of the
// "use client" theme module: a server component importing a constant from a
// client module gets a client reference, not the string.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
