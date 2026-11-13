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

describe("partial answers", () => {
  test("an answer with a runtime-error remark (a timeout cut it short) doesn't count", async () => {
    const { fetchImpl } = fakeFetch({ a: { ms: 10, body: { elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 25 seconds." } }, b: { ms: 40, body: { elements: [{ id: 2 }] } } });
    expect(await firstOverpassAnswer(["a", "b"], "query", { fetchImpl, timeoutMs: 1000 })).toEqual({ elements: [{ id: 2 }] });
  });
});

describe("retries", () => {
  // Each endpoint answers its planned steps in turn, then repeats the last one.
  function sequenceFetch(plan: Record<string, { status?: number; body?: unknown; text?: string }[]>) {
    const calls: Record<string, number> = {};
    const fetchImpl = (async (url: string) => {
      const steps = plan[url];
      const step = steps[Math.min(calls[url] ?? 0, steps.length - 1)];
      calls[url] = (calls[url] ?? 0) + 1;
      return new Response(step.text ?? JSON.stringify(step.body ?? { elements: [] }), { status: step.status ?? 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  test("a busy server (502, 429) is asked again after a pause, and each failure is logged with its reason", async () => {
    const { fetchImpl, calls } = sequenceFetch({ a: [{ status: 502, text: "<html><body>Bad Gateway</body></html>" }, { status: 429 }, { body: { elements: [{ id: 3 }] } }] });
    const lines: string[] = [];
    expect(await firstOverpassAnswer(["a"], "query", { fetchImpl, timeoutMs: 2000, retryDelaysMs: [10, 10], log: (line) => lines.push(line) })).toEqual({ elements: [{ id: 3 }] });
    expect(calls.a).toBe(3);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("attempt 1");
    expect(lines[0]).toContain("HTTP 502: Bad Gateway");
    expect(lines[1]).toContain("HTTP 429");
  });

  test("a rejected query (400) isn't retried", async () => {
    const { fetchImpl, calls } = sequenceFetch({ a: [{ status: 400, text: "parse error" }] });
    expect(await firstOverpassAnswer(["a"], "query", { fetchImpl, timeoutMs: 2000, retryDelaysMs: [10, 10] })).toBeNull();
    expect(calls.a).toBe(1);
  });

  test("an HTML page with a 200 counts as busy", async () => {
    const { fetchImpl, calls } = sequenceFetch({ a: [{ text: "<html>Too many requests</html>" }, { body: { elements: [] } }] });
    expect(await firstOverpassAnswer(["a"], "query", { fetchImpl, timeoutMs: 2000, retryDelaysMs: [10] })).toEqual({ elements: [] });
    expect(calls.a).toBe(2);
  });

  test("a retry that would start after the deadline isn't waited for", async () => {
    const { fetchImpl, calls } = sequenceFetch({ a: [{ status: 504 }] });
    const started = Date.now();
    expect(await firstOverpassAnswer(["a"], "query", { fetchImpl, timeoutMs: 200, retryDelaysMs: [5000] })).toBeNull();
    expect(Date.now() - started).toBeLessThan(150);
    expect(calls.a).toBe(1);
  });

  test("a request that hangs past its own limit is retried", async () => {
    let call = 0;
    const fetchImpl = ((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      call += 1;
      if (call > 1) return resolve(new Response(JSON.stringify({ elements: [{ id: 4 }] })));
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
    const lines: string[] = [];
    expect(await firstOverpassAnswer(["a"], "query", { fetchImpl, timeoutMs: 2000, attemptTimeoutMs: 50, retryDelaysMs: [10], log: (line) => lines.push(line) })).toEqual({ elements: [{ id: 4 }] });
    expect(lines[0]).toContain("no answer within");
  });
});
