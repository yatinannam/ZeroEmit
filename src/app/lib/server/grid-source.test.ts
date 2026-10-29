import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeRedis, fakeRedisModule, resetFakeRedis } from "./test-redis";

mock.module("./redis", () => fakeRedisModule);
process.env.INDIA_ENERGY_ATLAS_API_KEY = "test-key";
delete process.env.ELECTRICITY_MAPS_API_KEY;
const { getGridData, resetGridSourceMemory, ATLAS_DAILY_BUDGET } = await import("./grid-source");

// A zone response: 14 days of hourly readings ending an hour ago, newest first.
const zonePayload = () => ({ data: { items: Array.from({ length: 336 }, (_, i) => ({ timestamp: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), carbon_intensity_gco2_kwh: 500 + (i % 24), total_generation_mw: 80_000 })) } });

let calls: string[] = [];
let answer: (url: string) => Response = () => new Response(JSON.stringify(zonePayload()), { status: 200 });
const realFetch = globalThis.fetch;
beforeEach(() => {
  resetFakeRedis();
  resetGridSourceMemory();
  calls = [];
  answer = () => new Response(JSON.stringify(zonePayload()), { status: 200 });
  globalThis.fetch = (async (input: string | URL | Request) => { const url = String(input); calls.push(url); await new Promise((resolve) => setTimeout(resolve, 20)); return answer(url); }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });
const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const storeSnapshot = (zone: string, ageMs: number) => fakeRedis.strings.set(`zone:${zone}`, JSON.stringify({ latest: { carbon_intensity_gco2_kwh: 510, timestamp: new Date(Date.now() - ageMs).toISOString() }, pattern: Array(24).fill(520), fetchedAt: Date.now() - ageMs }));

describe("India Energy Atlas quota", () => {
  test("never calls the forecast endpoint, which the trial plan always refuses", async () => {
    expect((await getGridData("tamil-nadu")).data?.available).toBe(true);
    expect(calls.some((url) => url.includes("/forecast/"))).toBe(false);
    expect(calls.filter((url) => url.includes("/by-zone"))).toHaveLength(1);
  });

  test("a region refreshed within the hour isn't fetched again", async () => {
    storeSnapshot("southern", 40 * 60_000);
    expect((await getGridData("tamil-nadu")).data?.available).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("states in the same region refreshing at once make one call", async () => {
    storeSnapshot("southern", 2 * 3_600_000);
    const results = await Promise.all([getGridData("tamil-nadu"), getGridData("karnataka"), getGridData("kerala")]);
    expect(results.every((result) => result.data?.available)).toBe(true);
    expect(calls.filter((url) => url.includes("/by-zone"))).toHaveLength(1);
  });

  test("once the day's budget is spent, the last good data is served instead of calling", async () => {
    storeSnapshot("southern", 2 * 3_600_000);
    fakeRedis.strings.set(`atlas:calls:${istDay()}`, String(ATLAS_DAILY_BUDGET));
    const result = await getGridData("tamil-nadu");
    expect(calls).toHaveLength(0);
    expect(result.data?.available).toBe(true);
    expect(result.data?.forecastIsTypical).toBe(true);
    expect(result.data?.current).toBeUndefined(); // a 2-hour-old reading isn't "right now"
  });

  test("a rate-limited provider falls back to the last good data too", async () => {
    storeSnapshot("southern", 2 * 3_600_000);
    answer = () => new Response("{}", { status: 429 });
    const result = await getGridData("tamil-nadu");
    expect(result.data?.available).toBe(true);
    expect(calls.filter((url) => url.includes("/by-zone"))).toHaveLength(1);
  });

  test("calls are counted per IST day", async () => {
    await getGridData("maharashtra");
    expect(fakeRedis.strings.get(`atlas:calls:${istDay()}`)).toBe("1");
  });

  test("with no data at all and no budget, it says so rather than inventing values", async () => {
    fakeRedis.strings.set(`atlas:calls:${istDay()}`, String(ATLAS_DAILY_BUDGET));
    const result = await getGridData("maharashtra");
    expect(result.data).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
