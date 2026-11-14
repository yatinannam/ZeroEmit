import { describe, expect, test } from "bun:test";
import { BAR_COLOR, THEME_BOOT_SCRIPT } from "./theme-boot";

// Runs the inline script against a stand-in <head>: two theme-color metas, as
// layout.tsx's viewport.themeColor renders them, and the given saved values.
function boot(saved: Record<string, string>) {
  const metas = [{ media: "(prefers-color-scheme: light)", content: BAR_COLOR.light }, { media: "(prefers-color-scheme: dark)", content: BAR_COLOR.dark }];
  const attributes: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; } }, querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []) };
  const localStorage = { getItem: (key: string) => saved[key] ?? null };
  new Function("document", "localStorage", THEME_BOOT_SCRIPT)(document, localStorage);
  return { attributes, colors: metas.map((meta) => meta.content) };
}

describe("THEME_BOOT_SCRIPT", () => {
  test("a pinned theme sets both theme-color metas, so the status bar matches from the first paint", () => {
    expect(boot({ "zeroemit-theme": "dark", "zeroemit-location": "{}" })).toEqual({ attributes: { "data-theme": "dark" }, colors: [BAR_COLOR.dark, BAR_COLOR.dark] });
    expect(boot({ "zeroemit-theme": "light", "zeroemit-location": "{}" }).colors).toEqual([BAR_COLOR.light, BAR_COLOR.light]);
  });

  test("\"system\" leaves each meta on its own scheme's colour", () => {
    expect(boot({ "zeroemit-theme": "system", "zeroemit-location": "{}" })).toEqual({ attributes: {}, colors: [BAR_COLOR.light, BAR_COLOR.dark] });
  });

  test("no saved place marks the first run", () => {
    expect(boot({}).attributes).toEqual({ "data-first-run": "" });
  });
});
