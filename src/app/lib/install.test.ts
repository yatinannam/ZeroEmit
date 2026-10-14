import { describe, expect, test } from "bun:test";
import { DISMISS_DAYS, installPromptMode } from "./install";

const now = Date.UTC(2026, 9, 14, 12);
const base = { installed: false, dismissedUntil: null, now, hasPrompt: false, isIos: false };

describe("installPromptMode", () => {
  test("never shows once installed", () => {
    expect(installPromptMode({ ...base, installed: true, hasPrompt: true })).toBeNull();
    expect(installPromptMode({ ...base, installed: true, isIos: true })).toBeNull();
  });

  test("stays hidden while a dismissal has not expired", () => {
    expect(installPromptMode({ ...base, hasPrompt: true, dismissedUntil: now + 60_000 })).toBeNull();
    expect(installPromptMode({ ...base, isIos: true, dismissedUntil: now + DISMISS_DAYS * 86_400_000 })).toBeNull();
  });

  test("shows again once the dismissal has expired", () => {
    expect(installPromptMode({ ...base, hasPrompt: true, dismissedUntil: now - 1 })).toBe("install");
    expect(installPromptMode({ ...base, isIos: true, dismissedUntil: now })).toBe("ios");
  });

  test("a saved browser prompt means the Install button", () => {
    expect(installPromptMode({ ...base, hasPrompt: true })).toBe("install");
  });

  test("iOS without a prompt gets the Add to Home Screen steps", () => {
    expect(installPromptMode({ ...base, isIos: true })).toBe("ios");
  });

  test("neither a prompt nor iOS shows nothing", () => {
    expect(installPromptMode(base)).toBeNull();
  });
});
