import { describe, expect, test } from "bun:test";
import { firstOverpassAnswer } from "./overpass";

// A fake fetch: each endpoint answers after `ms` with a status (or never).
function fakeFetch(plan: Record<string, { ms: number; status?: number; body?: unknown }>) {
  const aborted: string[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const step = plan[url];
    const timer = setTimeout(() => resolve(new Response(JSON.stringify(step.body ?? { elements: [] }), { status: step.status ?? 200 })), step.ms);
    init?.signal?.addEventListener("abort", () => { clearTimeout(timer); aborted.push(url); reject(new DOMException("aborted", "AbortError")); });
  })) as typeof fetch;
  return { fetchImpl, aborted };
}

describe("firstOverpassAnswer", () => {
  test("asks every server at once and takes the first good answer, even from the last one listed", async () => {
    const { fetchImpl, aborted } = fakeFetch({
      a: { ms: 5000 }, // slow
      b: { ms: 10, status: 504 }, // fast but busy
      c: { ms: 30, body: { elements: [{ id: 1 }] } },
    });
    const started = Date.now();
    expect(await firstOverpassAnswer(["a", "b", "c"], "query", { fetchImpl, timeoutMs: 8000 })).toEqual({ elements: [{ id: 1 }] });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(aborted).toContain("a"); // the slow one is cancelled
  });

  test("null when every server fails or runs out of time", async () => {
    const { fetchImpl } = fakeFetch({ a: { ms: 10, status: 500 }, b: { ms: 5000 } });
    expect(await firstOverpassAnswer(["a", "b"], "query", { fetchImpl, timeoutMs: 100 })).toBeNull();
  });

  test("an answer that isn't Overpass JSON doesn't count", async () => {
    const { fetchImpl } = fakeFetch({ a: { ms: 10, body: { error: "rate limited" } }, b: { ms: 40, body: { elements: [] } } });
    expect(await firstOverpassAnswer(["a", "b"], "query", { fetchImpl, timeoutMs: 1000 })).toEqual({ elements: [] });
  });
});
