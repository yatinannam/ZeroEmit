import { describe, expect, test } from "bun:test";
import { readLimitedJson } from "./http";

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
