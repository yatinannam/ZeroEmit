// How long "Not now" on the install card keeps it hidden.
export const DISMISS_DAYS = 14;

export type InstallPromptMode = "install" | "ios" | null;

// Which install card to show, if any. "install" when the browser handed us a
// beforeinstallprompt event; "ios" for Safari on iPhone/iPad, which has no
// install API so we can only explain Add to Home Screen.
export function installPromptMode({ installed, dismissedUntil, now, hasPrompt, isIos }: { installed: boolean; dismissedUntil: number | null; now: number; hasPrompt: boolean; isIos: boolean }): InstallPromptMode {
  if (installed) return null;
  if (dismissedUntil !== null && now < dismissedUntil) return null;
  if (hasPrompt) return "install";
  if (isIos) return "ios";
  return null;
}
