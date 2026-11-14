import { describe, expect, test } from "bun:test";
import { sameServerKey, urlBase64ToUint8Array } from "./push-client";

describe("sameServerKey", () => {
  const key = urlBase64ToUint8Array("BOr7k2mGsWqW3n0p_zv-Hy5bQ1n5o2CqXGq1YkQ8n3s");

  test("a subscription made with this key is kept", () => {
    expect(sameServerKey(key.slice().buffer, key)).toBe(true);
  });

  test("one made with an earlier (rotated) key isn't, so the device subscribes again", () => {
    const old = key.slice();
    old[5] ^= 1;
    expect(sameServerKey(old.buffer, key)).toBe(false);
    expect(sameServerKey(key.slice(0, 10).buffer, key)).toBe(false);
  });

  test("a browser that doesn't report the key isn't resubscribed on every sync", () => {
    expect(sameServerKey(null, key)).toBe(true);
  });
});
