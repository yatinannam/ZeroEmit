// Public Overpass (OpenStreetMap) servers. They come and go and get
// overloaded: maps.mail.ru answers 504 to everything (checked 2026-11-12) and
// overpass.kumi.systems often doesn't answer at all, so all are asked at once
// and the first good answer wins, and each one is retried after a busy answer.
export const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Answers worth trying again later: rate limited or overloaded.
const BUSY_STATUSES = new Set([429, 500, 502, 503, 504]);

class OverpassError extends Error {
  constructor(message: string, readonly retry: boolean) { super(message); }
}

export type OverpassOptions = {
  fetchImpl?: typeof fetch;
  // The whole search, retries included.
  timeoutMs?: number;
  // One request; Overpass can queue a query for a while before running it.
  attemptTimeoutMs?: number;
  // The wait before each retry of a server that was busy; one retry per entry.
  retryDelaysMs?: number[];
  // Gets one line per failed attempt, so a failed run says why.
  log?: (line: string) => void;
};

function hostOf(server: string) {
  try { return new URL(server).host; } catch { return server; }
}

function excerpt(text: string) {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function firstOverpassAnswer(servers: string[], query: string, { fetchImpl = fetch, timeoutMs = 25_000, attemptTimeoutMs = 240_000, retryDelaysMs = [30_000, 90_000, 180_000], log = () => {} }: OverpassOptions = {}): Promise<unknown> {
  const outer = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => outer.abort(), timeoutMs);

  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    const pause = setTimeout(resolve, ms);
    outer.signal.addEventListener("abort", () => { clearTimeout(pause); reject(new OverpassError("stopped", false)); }, { once: true });
  });

  const attempt = async (server: string) => {
    const controller = new AbortController();
    const limit = Math.max(1, Math.min(attemptTimeoutMs, deadline - Date.now()));
    let timedOut = false;
    const attemptTimer = setTimeout(() => { timedOut = true; controller.abort(); }, limit);
    const stop = () => controller.abort();
    outer.signal.addEventListener("abort", stop, { once: true });
    try {
      const response = await fetchImpl(server, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ZeroEmit (https://zero-emit.vercel.app)" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) throw new OverpassError(`HTTP ${response.status}${text ? `: ${excerpt(text)}` : ""}`, BUSY_STATUSES.has(response.status));
      let body: { elements?: unknown; remark?: unknown };
      // A busy server sometimes answers 200 with an HTML page.
      try { body = JSON.parse(text); } catch { throw new OverpassError(`not JSON: ${excerpt(text)}`, true); }
      if (!Array.isArray(body?.elements)) throw new OverpassError("not Overpass JSON", true);
      // A query cut short by the server's own timeout still comes back as 200,
      // with partial (often empty) results and a "runtime error" remark.
      if (typeof body.remark === "string" && /error/i.test(body.remark)) throw new OverpassError(body.remark, true);
      return body;
    } catch (error) {
      if (error instanceof OverpassError) throw error;
      if (timedOut) throw new OverpassError(`no answer within ${Math.round(limit / 1000)}s`, true);
      throw new OverpassError(error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(attemptTimer);
      outer.signal.removeEventListener("abort", stop);
    }
  };

  const ask = async (server: string) => {
    for (let n = 1; ; n++) {
      const started = Date.now();
      try {
        return await attempt(server);
      } catch (error) {
        if (outer.signal.aborted) throw error;
        const failure = error as OverpassError;
        log(`Overpass ${hostOf(server)} attempt ${n} failed after ${Math.round((Date.now() - started) / 1000)}s: ${failure.message}`);
        const delay = retryDelaysMs[n - 1];
        if (!failure.retry || delay === undefined || Date.now() + delay >= deadline) throw error;
        await wait(delay);
      }
    }
  };

  try {
    return await Promise.any(servers.map(ask));
  } catch {
    return null; // every server failed or ran out of time
  } finally {
    clearTimeout(timer);
    outer.abort(); // cancel the ones still running or waiting to retry
  }
}
