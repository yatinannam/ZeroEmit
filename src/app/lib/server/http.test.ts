import { describe, expect, test } from "bun:test";
import { fromOwnSite, readLimitedJson } from "./http";

const post = (body: string, headers: Record<string, string> = {}) => new Request("http://x/api", { method: "POST", body, headers });

describe("readLimitedJson", () => {
  test("parses a body within the limit", async () => {
    expect(await readLimitedJson(post(`{"a":1}`), 100)).toEqual({ a: 1 });
  });

  test("refuses a declared length over the limit without reading it", async () => {
    expect(await readLimitedJson(post(`{"a":1}`, { "content-length": "5000" }), 100)).toBeNull();
  });

  test("counts bytes, not characters", async () => {
    // 40 Devanagari characters are 120 bytes in UTF-8.
    expect(await readLimitedJson(post(JSON.stringify("क".repeat(40))), 100)).toBeNull();
  });

  test("returns null for invalid JSON", async () => {
    expect(await readLimitedJson(post("{nope"), 100)).toBeNull();
  });
});

describe("fromOwnSite", () => {
  const request = (headers: Record<string, string>) => new Request("https://zero-emit.vercel.app/api/leaderboard/member", { method: "POST", headers });

  test("JSON from the app itself is accepted", () => {
    expect(fromOwnSite(request({ "content-type": "application/json", "sec-fetch-site": "same-origin", origin: "https://zero-emit.vercel.app" }))).toBe(true);
  });

  test("another website posting from a visitor's browser is refused", () => {
    expect(fromOwnSite(request({ "content-type": "application/json", "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toBe(false);
    expect(fromOwnSite(request({ "content-type": "application/json", origin: "https://evil.example" }))).toBe(false);
  });

  test("a form-style or text body is refused (it needs no CORS preflight)", () => {
    expect(fromOwnSite(request({ "content-type": "text/plain", "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(fromOwnSite(request({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  test("non-browser clients (no Origin or Sec-Fetch-Site) sending JSON are allowed", () => {
    expect(fromOwnSite(request({ "content-type": "application/json; charset=utf-8" }))).toBe(true);
  });
});
